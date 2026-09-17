import type { SwapRequest, TokenRef } from "./types";
/** Supported EVM chains. `gecko`, `llama`, and `dex` are provider platform ids; `usdc` is Circle's native USDC. Addresses are lowercase. */
export const CHAINS = {
  1: { name: "Ethereum", dex: "ethereum", gecko: "ethereum", llama: "ethereum", native: "ethereum", nativeSymbol: "ETH", explorer: "https://etherscan.io", usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
  8453: { name: "Base", dex: "base", gecko: "base", llama: "base", native: "ethereum", nativeSymbol: "ETH", explorer: "https://basescan.org", usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  42161: { name: "Arbitrum", dex: "arbitrum", gecko: "arbitrum-one", llama: "arbitrum", native: "ethereum", nativeSymbol: "ETH", explorer: "https://arbiscan.io", usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
  10: { name: "Optimism", dex: "optimism", gecko: "optimistic-ethereum", llama: "optimism", native: "ethereum", nativeSymbol: "ETH", explorer: "https://optimistic.etherscan.io", usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85" },
  137: { name: "Polygon", dex: "polygon", gecko: "polygon-pos", llama: "polygon", native: "polygon-ecosystem-token", nativeSymbol: "POL", explorer: "https://polygonscan.com", usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359" },
} as const;
export type ChainId = keyof typeof CHAINS;
export const CHAIN_IDS = Object.keys(CHAINS).map(Number) as ChainId[];
export const DEFAULT_CHAIN: ChainId = 8453;
export const NATIVE = "0x0000000000000000000000000000000000000000";
/** USDC kept back to cover the network fee the paymaster charges, in dollars.
 * Mainnet gas is worth real money; the rollups are worth fractions of a cent.
 * Unspent allowance is refunded, so this only has to be generous enough to let
 * the operation validate. */
export const feeReserveUsd = (chainId: number) => chainId === 1 ? 8 : chainId === 137 ? 0.1 : 0.25;
/** Circle's Paymaster is deployed at the same address on every chain here, so
 * the only question is whether the user is paying with the USDC it accepts.
 * Read by the server when authorizing and by the browser when signing. */
export const gaslessChain = (chainId: number) => [1, 10, 137, 8453, 42161].includes(chainId);
/** Ceiling on what Circle's Paymaster may pull for one swap, in USDC base units.
 * A permit is an allowance, not a charge — the unspent part is refunded — so this
 * only has to clear the real fee. Lives here because the server checks it before
 * authorizing and the browser signs the permit for it. */
export const feeCap = (chainId: number) => BigInt(Math.ceil(feeReserveUsd(chainId) * 2 * 1e6));
/** The supported chains whose network fee is cheapest, for pointing someone at
 * somewhere their balance can actually afford. Mainnet gas is worth real money;
 * the rollups are worth cents, and that difference decides whether a small
 * purchase is possible at all. */
export function cheaperChains(thanChainId: number) {
  const here = feeReserveUsd(thanChainId);
  return CHAIN_IDS.filter(id => gaslessChain(id) && feeReserveUsd(id) < here)
    .sort((a, b) => feeReserveUsd(a) - feeReserveUsd(b))
    .map(id => ({ id, name: CHAINS[id].name, feeUsd: feeReserveUsd(id) * 2 }));
}
export function chain(id: number) { const c = CHAINS[id as ChainId]; if (!c) throw new Error("Unsupported EVM chain. Choose Ethereum, Base, Arbitrum, Optimism, or Polygon."); return c; }
export function address(value: unknown): string { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Use an exact EVM token or wallet address."); return value.toLowerCase(); }
export function tokenRef(value: TokenRef): TokenRef { chain(value.chainId); return { chainId: value.chainId, address: address(value.address) }; }
export function swapRequest(value: SwapRequest): SwapRequest {
  chain(value.chainId);
  const tokenIn = address(value.tokenIn), tokenOut = address(value.tokenOut), wallet = address(value.wallet);
  if (wallet === NATIVE || tokenIn === tokenOut) throw new Error("Choose distinct tokens and a nonzero wallet.");
  if (typeof value.amount !== "string" || !/^[1-9][0-9]{0,77}$/.test(value.amount) || BigInt(value.amount) >= BigInt(2) ** BigInt(256)) throw new Error("Amount must be a positive integer string in token base units.");
  if (!Number.isInteger(value.slippageBps) || value.slippageBps < 1 || value.slippageBps > 100) throw new Error("Slippage must be between 1 and 100 basis points (0.01–1%).");
  return { chainId: value.chainId, tokenIn, tokenOut, wallet, amount: value.amount, slippageBps: value.slippageBps };
}
/** Exact decimal string → base units, with no floating point. Rejects more fraction digits than the token supports. */
export function parseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Token decimals are unavailable.");
  const m = /^\s*(\d{1,40})(?:\.(\d{1,40}))?\s*$/.exec(value.replace(/,/g, ""));
  if (!m) throw new Error("Enter an amount like 25 or 0.5.");
  const [, whole, fraction = ""] = m;
  if (fraction.length > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const base = (whole + fraction.padEnd(decimals, "0")).replace(/^0+/, "");
  if (!base) throw new Error("Enter an amount greater than zero.");
  return base;
}
/** Base units → human string for display. Null decimals leaves the raw integer. */
export function formatUnits(base: string, decimals: number | null, maxFraction = 6): string {
  if (!/^\d+$/.test(base)) return base;
  if (decimals === null || !Number.isInteger(decimals) || decimals < 0) return base;
  const padded = base.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0", fraction = padded.slice(padded.length - decimals).slice(0, maxFraction).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
export const shortAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
export const explorerTx = (chainId: number, hash: string) => `${chain(chainId).explorer}/tx/${hash}`;
export const explorerAddress = (chainId: number, addr: string) => `${chain(chainId).explorer}/address/${addr}`;
