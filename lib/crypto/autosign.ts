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
  client ??= new PrivyClient({ appId, appSecret, walletApi: { authorizationPrivateKey: process.env.PRIVY_AUTHORIZATION_KEY } } as never);
  return client;
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
          const { signature } = await privy().wallets().ethereum().signMessage(walletId, { message: String(params[0]) });
          return signature;
        }
        case 'eth_signTypedData_v4': {
          const typed = typeof params[1] === 'string' ? JSON.parse(params[1] as string) : params[1];
          const { signature } = await privy().wallets().ethereum().signTypedData(walletId, { params: { typed_data: typed } });
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
    const { authorization } = await privy().wallets().ethereum().sign7702Authorization(walletId, {
      params: { contract: contractAddress, chain_id: chainId ?? 0 },
    });
    return {
      r: authorization.r as `0x${string}`,
      s: authorization.s as `0x${string}`,
      yParity: authorization.y_parity,
      address,
      chainId: Number(authorization.chain_id),
      nonce: Number(authorization.nonce),
    };
  };
}
