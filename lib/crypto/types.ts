/** Provider-neutral identities. Symbols are display labels, never execution identifiers. */
export type TokenRef = { chainId: number; address: string };
export type Token = TokenRef & { symbol: string; name: string };
export type Pair = { source: "dexscreener"; chain: string; address: string; dex: string; url: string; base: { address: string; symbol: string; name: string }; quote: { address: string; symbol: string; name: string }; priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null; change24h: number | null; marketCap: number | null; fetchedAt: string };
export type SwapRequest = { chainId: number; tokenIn: string; tokenOut: string; amount: string; slippageBps: number; wallet: string };
export type PermitData = { domain: { name: string; chainId: number; verifyingContract: string }; types: Record<string, { name: string; type: string }[]>; values: { details: { token: string; amount: string; expiration: string; nonce: string }; spender: string; sigDeadline: string } };
export type SwapQuote = { provider: "uniswap"; request: SwapRequest; outputAmount: string; minimumOutput: string; expiresAt: number; raw: Record<string, unknown>; permitData?: PermitData };
export type Transaction = { chainId: number; from: string; to: string; data: string; value: string; nonce?: string; gasLimit?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string; gasPrice?: string };
/** One leg of an account-abstraction batch. Values are decimal base-unit strings so state stays JSON-safe. */
export type Call = { to: string; value: string; data: string };
/** What the server authorized for a single signature: the calls, and the exact
 * account calldata they encode to. The chain is later held to this calldata. */
export type SwapBatch = { chainId: number; sender: string; calls: Call[]; callData: string; paymaster: "circle-usdc" | null };
export interface DiscoveryProvider { search(query: string): Promise<Pair[]>; pairs(token: TokenRef): Promise<Pair[]> }
/** `autonomous` travels to the venue as the declared decision origin: true only
 * when the agent decided and settled it with nobody present. */
export type ExecutionOptions = { batchedApprovals?: boolean; autonomous?: boolean };
export interface ExecutionProvider { quote(request: SwapRequest, options?: ExecutionOptions): Promise<SwapQuote>; swap(quote: SwapQuote, signature?: string, options?: ExecutionOptions): Promise<Transaction> }
export interface ValuationProvider { value(token: TokenRef, amount: string): Promise<number> }
/** Display-only token facts captured at proposal time. Never used for execution. */
export type TokenDisplay = { symbol: string; decimals: number | null };
export type CryptoTrade = { bridge?: import("./bridge-types").BridgeState; request: SwapRequest; outputAmount: string; minimumOutput: string; expiresAt: number; phase: "ready" | "authorizing" | "issued" | "complete"; quote?: SwapQuote; quoteId?: string; history?: { step: "approval" | "swap"; hash: string; result: "confirmed" | "reverted" }[]; step?: "approval" | "swap"; transaction?: Transaction; batch?: SwapBatch; userOpHash?: string; hash?: string; detail?: string; display?: { tokenIn: TokenDisplay; tokenOut: TokenDisplay } };
