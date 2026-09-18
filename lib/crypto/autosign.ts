import 'server-only';
import { PrivyClient } from '@privy-io/node';
import { chain } from './chains';
import { rpc } from './rpc';
import type { SignAuthorization, WalletProvider } from './gasless';

/** Server-side signing for a wallet the user has delegated to Rubicon.
 *
 * Privy session signers sign inside a secure enclave; no private key ever
 * reaches this process, and the user grants and revokes the signer themselves.
 * The point of shaping this as a `WalletProvider` is that the autonomous path
 * then reuses the *same* `sendSwapBatch` the browser uses — same Circle
 * Paymaster, same 7702 account, same calldata the server authorized — rather
 * than a second execution path that would have to be proved correct again. */

let client: PrivyClient | null = null;
function privy(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error('Privy is not configured for server-side signing.');
  // An authorization key is what proves this app may use a delegated signer.
  if (!process.env.PRIVY_AUTHORIZATION_KEY) throw new Error('PRIVY_AUTHORIZATION_KEY is not set, so no wallet may be signed for without the user present.');
  // This SDK has no `walletApi` option: the authorization key is supplied per
  // call, not on the client. The old shape needed an `as never` to compile and
  // was then dropped on the floor, so every request went out unsigned and Privy
  // answered 401 — which nothing reached far enough to see.
  client ??= new PrivyClient({ appId, appSecret });
  return client;
}

/** Proves this app may act for a delegated wallet. Privy signs each request with
 * it and sends the result as `privy-authorization-signature`; it wants raw
 * base64 PKCS8, so the stored `wallet-auth:` prefix comes off here. */
function authorization() {
  return { authorization_private_keys: [String(process.env.PRIVY_AUTHORIZATION_KEY).replace(/^wallet-auth:/, "")] };
}

export const autoSigningConfigured = () =>
  !!(process.env.NEXT_PUBLIC_PRIVY_APP_ID && process.env.PRIVY_APP_SECRET && process.env.PRIVY_AUTHORIZATION_KEY);

/** Reads go to our own RPC; signatures go to Privy. Anything that could move
 * funds without a signature we control is refused rather than forwarded. */
export function delegatedProvider(walletId: string, address: string, chainId: number): WalletProvider {
  const wallet = address.toLowerCase();
  chain(chainId);
  return {
    async request({ method, params = [] }) {
      switch (method) {
        case 'eth_chainId': return `0x${chainId.toString(16)}`;
        case 'eth_accounts': case 'eth_requestAccounts': return [wallet];
        case 'personal_sign': {
          // The SDK is not uniform here: `signMessage` flattens its parameter,
          // while the two below keep theirs nested under `params`.
          const { signature } = await privy().wallets().ethereum().signMessage(walletId, { message: String(params[0]), authorization_context: authorization() });
          return signature;
        }
        case 'eth_signTypedData_v4': {
          const typed = typeof params[1] === 'string' ? JSON.parse(params[1] as string) : params[1];
          // EIP-712 names this field `primaryType`; Privy's API names it
          // `primary_type` and rejects the other outright. Callers here build
          // standards-compliant payloads — the browser signs the very same
          // object — so the rename belongs at this boundary and nowhere else.
          // Getting this wrong meant no unattended purchase could ever be
          // signed, and it failed at the last step, where nothing else had
          // reached to notice.
          const { primaryType, primary_type, ...rest } = typed as Record<string, unknown> & { primaryType?: string; primary_type?: string };
          const typedData = { ...rest, primary_type: primary_type ?? primaryType };
          const { signature } = await privy().wallets().ethereum().signTypedData(walletId, { params: { typed_data: typedData as never }, authorization_context: authorization() });
          return signature;
        }
        // A delegated wallet never broadcasts a raw transaction here: every
        // autonomous purchase settles as a sponsored user operation, so the
        // paymaster and the authorized calldata stay in the loop.
        case 'eth_sendTransaction': case 'eth_sign': case 'eth_signTransaction':
          throw new Error('A delegated wallet signs sponsored operations only.');
        default:
          return rpc(chainId, method, params as unknown[]);
      }
    },
  };
}

/** EIP-7702 authorization, so the account the paymaster expects is the one that
 * executes. Shaped like the browser hook's return value. */
export function delegatedAuthorization(walletId: string, address: string): SignAuthorization {
  return async ({ contractAddress, chainId }) => {
    // The signature comes back wrapped in an `authorization`, in snake_case, and
    // carries the nonce Privy used — which is the one the operation must quote.
    const { authorization: signed } = await privy().wallets().ethereum().sign7702Authorization(walletId, {
      params: { contract: contractAddress, chain_id: chainId ?? 0 },
      authorization_context: authorization(),
    });
    return {
      r: signed.r as `0x${string}`,
      s: signed.s as `0x${string}`,
      yParity: signed.y_parity,
      address,
      chainId: Number(signed.chain_id),
      nonce: Number(signed.nonce),
    };
  };
}
