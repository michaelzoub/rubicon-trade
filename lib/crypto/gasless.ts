/** Submits a server-authorized swap batch as an ERC-4337 user operation, with
 * Circle's Paymaster taking the network fee out of the user's USDC.
 *
 * The wallet address never changes: EIP-7702 points the existing Privy EOA at
 * Simple7702Account, so the USDC already sitting there is what pays. */
import { createPublicClient, custom, encodePacked, erc20Abi, getContract, hexToBigInt, maxUint256, parseAbi, type Chain } from "viem";
import { toAccount } from "viem/accounts";
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains";
import { createBundlerClient, toSimple7702SmartAccount } from "viem/account-abstraction";
import { bundlerUrl, CIRCLE_PAYMASTER, SIMPLE_7702_ACCOUNT } from "./aa";
import { chain } from "./chains";
import { readPurchaseBalance, feeCap } from "./readiness";
import type { SwapBatch } from "./types";

const CHAIN_OBJECTS = { 1: mainnet, 10: optimism, 137: polygon, 8453: base, 42161: arbitrum } as const;

/** What Privy's `getEthereumProvider()` actually hands back. Viem's own
 * EIP1193Provider type enumerates methods and rejects `eth_signTypedData_v4`. */
export type WalletProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
const permitAbi = parseAbi(["function nonces(address owner) view returns (uint256)", "function version() view returns (string)"]);

export type SignAuthorization = (input: { contractAddress: `0x${string}`; chainId?: number }, options?: { address?: string }) =>
  Promise<{ r: `0x${string}`; s: `0x${string}`; v?: bigint; yParity: number; address: string; chainId: number; nonce: number }>;

/** EIP-712 over an EIP-1193 provider. `eth_signTypedData_v4` wants JSON, and the
 * domain type has to be spelled out — viem omits it, wallets require it. */
function typedDataSigner(provider: WalletProvider, address: string) {
  return async ({ domain, types, primaryType, message }: Record<string, unknown> & { domain?: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: unknown }) => {
    const domainTypes = [
      ["name", "string"], ["version", "string"], ["chainId", "uint256"], ["verifyingContract", "address"], ["salt", "bytes32"],
    ].filter(([key]) => domain?.[key] !== undefined).map(([name, type]) => ({ name, type }));
    const payload = JSON.stringify({ domain: domain ?? {}, types: { EIP712Domain: domainTypes, ...types }, primaryType, message },
      (_k, v) => typeof v === "bigint" ? v.toString() : v);
    return provider.request({ method: "eth_signTypedData_v4", params: [address, payload] }) as Promise<`0x${string}`>;
  };
}

/** Circle takes its fee by pulling USDC under an EIP-2612 permit signed here and
 * carried inside the operation, so nothing has to be approved onchain first. */
function circlePaymaster(usdc: string, account: { address: string; signTypedData: (d: never) => Promise<`0x${string}`> }, client: ReturnType<typeof createPublicClient>, allowance: bigint) {
  return {
    async getPaymasterData() {
      const token = getContract({ client, address: usdc as `0x${string}`, abi: [...erc20Abi, ...permitAbi] });
      const [name, version, nonce] = await Promise.all([token.read.name(), token.read.version(), token.read.nonces([account.address as `0x${string}`])]);
      const signature = await account.signTypedData({
        domain: { name, version, chainId: client.chain!.id, verifyingContract: usdc },
        types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
        primaryType: "Permit",
        // The paymaster runs under 4337 opcode rules and cannot read block.timestamp,
        // so the permit cannot carry a real deadline.
        message: { owner: account.address, spender: CIRCLE_PAYMASTER, value: allowance, nonce, deadline: maxUint256 },
      } as never);
      return {
        paymaster: CIRCLE_PAYMASTER as `0x${string}`,
        paymasterData: encodePacked(["uint8", "address", "uint256", "bytes"], [0, usdc as `0x${string}`, allowance, signature]),
        paymasterVerificationGasLimit: 200_000n, paymasterPostOpGasLimit: 35_000n, isFinal: true,
      };
    },
  };
}

/** Ceiling on what the paymaster may pull for this swap, in USDC base units. A
 * permit is an allowance, not a charge — the paymaster refunds whatever it does
 * not spend — so this only has to clear the real fee. Twice the reserve the buy
 * screen asks the user to keep back, which on mainnet is dollars and on the
 * rollups is cents. */
const feeAllowance = feeCap;

export async function sendSwapBatch({ batch, provider, signAuthorization, onSubmitted, expiresAt, requiredUsdc }: {
  batch: SwapBatch; provider: WalletProvider; signAuthorization: SignAuthorization;
  onSubmitted?: (hash: string) => void; expiresAt?: number; requiredUsdc?: bigint;
}): Promise<{ userOpHash: string; hash: string }> {
  const viemChain = CHAIN_OBJECTS[batch.chainId as keyof typeof CHAIN_OBJECTS];
  if (!viemChain || !batch.paymaster) throw new Error(`Gasless swaps are not available on ${chain(batch.chainId).name}.`);

  const assertContext = async () => {
    if (expiresAt && Date.now() >= expiresAt) throw new Error("Quote expired. Request a fresh quote.");
    const funds = await readPurchaseBalance(provider, batch.sender, batch.chainId);
    if (funds.usdc < (requiredUsdc ?? feeCap(batch.chainId))) throw new Error("Insufficient USDC on this network.");
  };
  await assertContext();
  const guardedProvider: WalletProvider = { request: async args => {
    if (['personal_sign', 'eth_signTypedData_v4'].includes(args.method)) await assertContext();
    return provider.request(args);
  } };
  // One concrete chain type: the union of five would make every downstream
  // viem generic irreconcilable without changing a single runtime value.
  const client = createPublicClient({ chain: viemChain as Chain, transport: custom(provider as Parameters<typeof custom>[0]) });
  const owner = toAccount({
    address: batch.sender as `0x${string}`,
    signMessage: async ({ message }) => guardedProvider.request({ method: "personal_sign", params: [typeof message === "string" ? message : (message as { raw: string }).raw, batch.sender] }) as Promise<`0x${string}`>,
    signTypedData: typedDataSigner(guardedProvider, batch.sender) as never,
    signTransaction: async () => { throw new Error("This wallet signs user operations, not raw transactions."); },
  });
  const account = await toSimple7702SmartAccount({ client, owner: owner as never });

  const usdc = chain(batch.chainId).usdc;
  const bundler = createBundlerClient({
    account, client, transport: custom({ request: ({ method, params }: { method: string; params?: unknown[] }) => fetch(bundlerUrl(batch.chainId), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then(async r => { const j = await r.json(); if (j.error) throw new Error(j.error.message ?? "Bundler request failed."); return j.result; }) }),
    paymaster: circlePaymaster(usdc, account as never, client, feeAllowance(batch.chainId)),
    userOperation: {
      estimateFeesPerGas: async ({ bundlerClient }) => {
        // Pimlico prices user operations on its own endpoint; anything else falls
        // back to the chain's own fee estimate.
        try {
          const { standard } = await bundlerClient.request({ method: "pimlico_getUserOperationGasPrice" } as never) as { standard: { maxFeePerGas: `0x${string}`; maxPriorityFeePerGas: `0x${string}` } };
          return { maxFeePerGas: hexToBigInt(standard.maxFeePerGas), maxPriorityFeePerGas: hexToBigInt(standard.maxPriorityFeePerGas) };
        } catch { const fees = await client.estimateFeesPerGas(); return { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }; }
      },
    },
  });

  // A wallet already delegated to this implementation needs no new authorization;
  // re-sending one on every swap would just cost the user gas.
  const code = await client.getCode({ address: batch.sender as `0x${string}` });
  const delegated = code?.toLowerCase() === `0xef0100${SIMPLE_7702_ACCOUNT.slice(2)}`;
  if (code && code !== "0x" && !delegated) throw new Error("This wallet already uses a different smart account. Its configuration was not changed.");
  await assertContext();
  const authorization = delegated ? undefined : await signAuthorization({ contractAddress: SIMPLE_7702_ACCOUNT as `0x${string}`, chainId: batch.chainId }, { address: batch.sender });

  const userOpHash = await bundler.sendUserOperation({
    account,
    calls: batch.calls.map(c => ({ to: c.to as `0x${string}`, value: BigInt(c.value), data: c.data as `0x${string}` })),
    ...(authorization ? { authorization: authorization as never } : {}),
  });
  onSubmitted?.(userOpHash);
  const receipt = await bundler.waitForUserOperationReceipt({ hash: userOpHash });
  return { userOpHash, hash: receipt.receipt.transactionHash };
}

/** Read-only recovery after a receipt timeout or page reload. Never resubmits. */
export async function recoverSwapOperation(chainId: number, userOpHash: string): Promise<string | null> {
  chain(chainId);
  if (!/^0x[0-9a-f]{64}$/i.test(userOpHash)) throw new Error('Invalid operation reference.');
  const response = await fetch(bundlerUrl(chainId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getUserOperationReceipt', params: [userOpHash] }) });
  if (!response.ok) throw new Error('Confirmation service unavailable.');
  const body = await response.json();
  if (body.error) throw new Error('Confirmation service unavailable.');
  const hash = body.result?.receipt?.transactionHash;
  return typeof hash === 'string' && /^0x[0-9a-f]{64}$/i.test(hash) ? hash : null;
}
