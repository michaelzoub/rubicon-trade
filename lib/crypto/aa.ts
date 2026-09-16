/** ERC-4337 v0.8 + EIP-7702 primitives, shared by the server (which authorizes and
 * verifies a batch) and the browser (which signs and submits it).
 *
 * Why this exists: a Privy embedded wallet is a fresh EOA holding only the USDC a
 * user deposited. A plain `eth_sendTransaction` therefore dies at the node's
 * balance check — "insufficient funds for gas". Delegating that same EOA to a
 * 7702 smart account lets Circle's Paymaster pay the gas and take USDC instead,
 * so the address, and the funds already at it, never move.
 *
 * No "server-only": the trade card imports this too. */
import { encodeFunctionData, decodeFunctionData, parseAbi } from "viem";
import type { Call } from "./types";

/** Canonical, identical on every chain we support. */
export const ENTRY_POINT = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
/** eth-infinitism Simple7702Account — the code a delegated EOA runs. Must match
 * viem's `toSimple7702SmartAccount` default, which is what the browser builds. */
export const SIMPLE_7702_ACCOUNT = "0xe6cae83bde06e4c305530e199d7217f42808555b";
/** Circle Paymaster v0.8. Permissionless: no account, no API key, no funded
 * treasury of ours. It charges the user's USDC for gas plus a ~10% markup. */
export const CIRCLE_PAYMASTER = "0x0578cfb241215b77442a541325d6a4e6dfe700ec";
/** Uniswap's Permit2, identical on every chain. */
export const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

/** Public bundler. Shared and rate-limited rather than unavailable, so a
 * dedicated endpoint can be swapped in without touching anything else. */
export const bundlerUrl = (chainId: number) =>
  process.env.NEXT_PUBLIC_BUNDLER_URL?.replace("{chainId}", String(chainId)) ?? `https://public.pimlico.io/v2/${chainId}/rpc`;

const accountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch((address target, uint256 value, bytes data)[] calls)",
]);
const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
const permit2Abi = parseAbi([
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
]);

export const erc20ApproveData = (spender: string, amount: bigint) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender as `0x${string}`, amount] });
export const erc20AllowanceData = (owner: string, spender: string) =>
  encodeFunctionData({ abi: erc20Abi, functionName: "allowance", args: [owner as `0x${string}`, spender as `0x${string}`] });
export const permit2ApproveData = (token: string, spender: string, amount: bigint, expiration: number) =>
  encodeFunctionData({ abi: permit2Abi, functionName: "approve", args: [token as `0x${string}`, spender as `0x${string}`, amount, expiration] });
export const permit2AllowanceData = (owner: string, token: string, spender: string) =>
  encodeFunctionData({ abi: permit2Abi, functionName: "allowance", args: [owner as `0x${string}`, token as `0x${string}`, spender as `0x${string}`] });

/** Byte-for-byte what viem's `toSimple7702SmartAccount.encodeCalls` produces, so
 * the server can name the exact calldata it authorized and later insist the chain
 * ran that and nothing else. A divergence here would silently widen what a
 * client could get away with, so `aa.test.ts` pins it against viem itself. */
export function encodeAccountCalls(calls: Call[]): string {
  if (calls.length === 0) throw new Error("A swap needs at least one call.");
  if (calls.length === 1) {
    const [call] = calls;
    return encodeFunctionData({ abi: accountAbi, functionName: "execute", args: [call.to as `0x${string}`, BigInt(call.value), call.data as `0x${string}`] });
  }
  return encodeFunctionData({ abi: accountAbi, functionName: "executeBatch", args: [calls.map(c => ({ target: c.to as `0x${string}`, value: BigInt(c.value), data: c.data as `0x${string}` }))] });
}

export function decodeAccountCalls(data: string): Call[] {
  const result = decodeFunctionData({ abi: accountAbi, data: data as `0x${string}` });
  if (result.functionName === "execute") { const [to, value, d] = result.args; return [{ to: to.toLowerCase(), value: value.toString(), data: d.toLowerCase() }]; }
  return result.args[0].map(c => ({ to: c.target.toLowerCase(), value: c.value.toString(), data: c.data.toLowerCase() }));
}
