import { resolvePurchaseRoute } from "./route-resolver";
import "server-only";
import { cryptoServices } from "./services";
import { userWallets, ownedWallet } from "./wallet";
import { proposeSwap } from "./trades";
import { CHAINS } from "./chains";
import type { SwapRequest } from "./types";
import type { AgentContext, ToolSchema } from "@/lib/socialtrading/agents/registry";
import type { MessagePart } from "@/lib/socialtrading/types";
const token = { chainId: { type: "integer", enum: Object.keys(CHAINS).map(Number) }, address: { type: "string", description: "Exact EVM token contract address." } };
const swap = { chainId: token.chainId, tokenIn: token.address, tokenOut: token.address, amount: { type: "string", description: "Exact integer input amount in base units. Resolve token decimals first. Never use floating-point arithmetic for base-unit conversion." }, slippageBps: { type: "integer", minimum: 1, maximum: 100 }, wallet: { type: "string", description: "A wallet returned by get_crypto_wallets." } };
function tool(name: string, description: string, properties: object, required: string[] = []): ToolSchema { return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }; }
export const CRYPTO_TOOLS = [
  tool("check_purchase_bridges", "Answer 'can I afford this?' for a purchase. Reads USDC across every supported network and resolves the route the app would take, returning the chosen route and why each other network was rejected. Read-only; reports failures individually. Never claim funds were moved. Amount is human USDC units. The user signs from Buy; no network is chosen by hand.", { wallet: swap.wallet, destinationChainId: token.chainId, tokenOut: token.address, amount: { type: "string" } }, ["wallet", "destinationChainId", "tokenOut", "amount"]),
  tool("discover_crypto_pairs", "Discover live DEX pairs, token contract identities, liquidity, volume, and price changes. Results are market data, not a safety endorsement.", { query: { type: "string" } }, ["query"]),
  tool("research_crypto_token", "Research an exact chain + contract with DexScreener, CoinGecko metadata (including decimals), and DefiLlama. Partial provider failures are reported.", token, ["chainId", "address"]),
  tool("crypto_history", "CoinGecko price, market cap, and volume history for a CoinGecko id.", { id: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 365 } }, ["id"]),
  tool("research_defi", "Find DeFi protocols with chains, categories, and TVL from DefiLlama.", { query: { type: "string" } }),
  tool("get_crypto_wallets", "List this user's existing Privy-linked EVM wallets and supported execution chains. Ask the user to select when multiple wallets are linked.", {}),
  tool("quote_crypto_swap", "Get a fresh exact-input Uniswap quote. Read-only: does not execute or reserve funds. Same-chain EVM V2/V3 swaps only.", swap, Object.keys(swap)),
  tool("propose_crypto_swap", "Propose a Uniswap swap through the user's Privy-linked wallet. Enforces server-valued USD limits and shows a review/sign card. Wallet confirmation is required even in automatic mode. Never claim execution from a quote or proposal.", { ...swap, reasoning: { type: "string" } }, [...Object.keys(swap), "reasoning"]),
];
export const cryptoToolGroup = (name: string) => ["check_purchase_bridges", "get_crypto_wallets", "quote_crypto_swap", "propose_crypto_swap"].includes(name) ? "trading" : "market";
export async function executeCryptoTool(name: string, args: Record<string, unknown>, context: AgentContext<import("@/lib/socialtrading/agents/services").AgentServices>): Promise<{ result: unknown; parts: MessagePart[] }> {
  const services = context.services.onchain ?? cryptoServices;
  const text = (v: unknown, fallback = "") => typeof v === "string" ? v.slice(0, 100) : fallback;
  switch (name) {
    case "check_purchase_bridges": return { result: await resolvePurchaseRoute(context.userId, { wallets: [text(args.wallet)], destinationChainId: args.destinationChainId as number, tokenOut: text(args.tokenOut), amount: text(args.amount) }), parts: [] };
    case "discover_crypto_pairs": return { result: await services.discovery.search(text(args.query)), parts: [] };
    case "research_crypto_token": return { result: await services.research({ chainId: args.chainId as number, address: text(args.address) }), parts: [] };
    case "crypto_history": {
      const history = await services.metadata.history(text(args.id), args.days === undefined ? 30 : args.days as number);
      const sample = (points: [number, number][]) => points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 60)) === 0 || i === points.length - 1);
      return { result: { source: "CoinGecko", sampled: true, prices: sample(history.prices), marketCaps: sample(history.market_caps), volumes: sample(history.total_volumes) }, parts: [] };
    }
    case "research_defi": return { result: { source: "DefiLlama", protocols: await services.defi.protocols(text(args.query)), fetchedAt: new Date().toISOString() }, parts: [] };
    case "get_crypto_wallets": return { result: { wallets: await userWallets(context.userId), chains: CHAINS, signing: "User confirms each transaction in their wallet; no delegated signer.", usdc: Object.fromEntries(Object.entries(CHAINS).map(([id, c]) => [id, c.usdc])) }, parts: [] };
    case "quote_crypto_swap": {
      await ownedWallet(context.userId, args.wallet as string);
      const quote = await services.execution.quote(args as SwapRequest);
      const { raw: _raw, ...summary } = quote; return { result: summary, parts: [] };
    }
    case "propose_crypto_swap": {
      const trade = await proposeSwap(context.state, context.userId, args as SwapRequest, typeof args.reasoning === "string" ? args.reasoning : "", services);
      const instruction = trade.status === "blocked" ? "Explain the policy reason plainly; nothing was reserved." : trade.status === "reserved" ? "Within the user's limits and reserved against them. Nothing settles until they sign in their wallet; say so." : "Waiting for the user to review and sign from the swap card. A quote is not an executed trade.";
      return { result: { tradeId: trade.id, status: trade.status, valueUsd: trade.value, policy: trade.policy.reason, swap: { request: trade.crypto!.request, outputAmount: trade.crypto!.outputAmount, minimumOutput: trade.crypto!.minimumOutput, display: trade.crypto!.display }, instruction }, parts: [{ type: "trade", tradeId: trade.id }] };
    }
    default: throw new Error("Unknown crypto tool.");
  }
}
