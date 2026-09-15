/** Provider-neutral identities. Symbols are display labels, never execution identifiers. */
export type TokenRef = { chainId: number; address: string };
export type Token = TokenRef & { symbol: string; name: string };
export type Pair = { source: "dexscreener"; chain: string; address: string; dex: string; url: string; base: { address: string; symbol: string; name: string }; quote: { address: string; symbol: string; name: string }; priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null; change24h: number | null; marketCap: number | null; fetchedAt: string };
export type SwapRequest = { chainId: number; tokenIn: string; tokenOut: string; amount: string; slippageBps: number; wallet: string };
export type SwapQuote = { provider: "uniswap"; request: SwapRequest; outputAmount: string; minimumOutput: string; expiresAt: number; raw: Record<string, unknown> };
export type Transaction = { chainId: number; from: string; to: string; data: string; value: string; gasLimit?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string; gasPrice?: string };
export interface DiscoveryProvider { search(query: string): Promise<Pair[]>; pairs(token: TokenRef): Promise<Pair[]> }
export interface ExecutionProvider { quote(request: SwapRequest): Promise<SwapQuote>; approval(request: SwapRequest): Promise<Transaction | null>; swap(quote: SwapQuote): Promise<Transaction> }
export interface ValuationProvider { value(token: TokenRef, amount: string): Promise<number> }
/** Display-only token facts captured at proposal time. Never used for execution. */
export type TokenDisplay = { symbol: string; decimals: number | null };
export type CryptoTrade = { request: SwapRequest; outputAmount: string; minimumOutput: string; expiresAt: number; phase: "ready" | "issued" | "complete"; step?: "approval" | "swap"; transaction?: Transaction; hash?: string; detail?: string; display?: { tokenIn: TokenDisplay; tokenOut: TokenDisplay } };
