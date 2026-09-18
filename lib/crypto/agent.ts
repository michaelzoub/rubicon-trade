import { resolvePurchaseRoute } from "./route-resolver";
import "server-only";
import { cryptoServices } from "./services";
import { userWallets, ownedWallet } from "./wallet";
import { scanHoldings } from "./recovery";
import { proposeSwap } from "./trades";
import { CHAINS, chain, parseUnits } from "./chains";
import { BUY_CHAIN, tradability } from "./tradable";
import { autonomyState, executeAutonomousBuy } from "./autonomous";
import { delegatedWallet, firstDelegatedWallet } from "./wallet";
import { CATALOG_ENTRIES } from "./catalog";
import type { SwapRequest } from "./types";
import type { AgentContext, ToolSchema } from "@/lib/socialtrading/agents/registry";
import type { MessagePart } from "@/lib/socialtrading/types";
/** USDC held back from every unattended purchase so the paymaster's fee has
 * somewhere to come from. Above `feeCap` on Base ($0.50) with room to spare —
 * the cost of being wrong here is a purchase that fails validation outright. */
const FEE_HOLDBACK = 600_000n;
/** Whether a failure is worth waiting out rather than giving up on. */
const transientRead = (error: unknown) => {
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
  return status === 429 || (status >= 500 && status < 600)
    || /rate limit|timed out|timeout|temporarily|ECONNRESET|socket hang up/i.test(String((error as Error)?.message ?? ""));
};
/** `rpc` already retries a transient failure four times across about two seconds.
 * A purchase is worth waiting longer than that: giving up here does not just lose
 * a read, it sends the agent back around to attempt the whole buy again. Bounded
 * at four rounds — roughly six seconds — so a run still finishes. */
async function readWithPatience<T>(read: () => Promise<T>, rounds = 4): Promise<T> {
  for (let round = 0; ; round++) {
    try { return await read(); }
    catch (error) {
      if (round >= rounds - 1 || !transientRead(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 800 * 2 ** round + Math.random() * 300));
    }
  }
}

/** ERC-20 balanceOf, read straight from the chain rather than a provider. */
async function usdcBalance(chainId: number, wallet: string): Promise<bigint> {
  const { rpc } = await import("./rpc");
  const raw = await rpc<string>(chainId, "eth_call", [{ to: chain(chainId).usdc, data: `0x70a08231${wallet.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"]);
  if (!/^0x[0-9a-f]*$/i.test(raw ?? "")) throw new Error("Could not read your USDC balance right now. Try again shortly.");
  return BigInt(raw || "0x0");
}
const token = { chainId: { type: "integer", enum: Object.keys(CHAINS).map(Number) }, address: { type: "string", description: "Exact EVM token contract address." } };
const swap = { chainId: { type: "integer", enum: [BUY_CHAIN], description: `Rubicon settles every agent purchase on ${chain(BUY_CHAIN).name} (${BUY_CHAIN}). No other network is accepted.` }, tokenIn: token.address, tokenOut: token.address, amount: { type: "string", description: "Exact integer input amount in base units. Resolve token decimals first. Never use floating-point arithmetic for base-unit conversion." }, slippageBps: { type: "integer", minimum: 1, maximum: 100 }, wallet: { type: "string", description: "A wallet returned by get_crypto_wallets." } };
function tool(name: string, description: string, properties: object, required: string[] = []): ToolSchema { return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }; }
export const CRYPTO_TOOLS = [
  tool("check_purchase_funds", `Answer "can I afford this?" before proposing. Reads the user's USDC on ${chain(BUY_CHAIN).name} and reports whether the purchase is fundable. Read-only; never claim funds were moved. Amount is human USDC units. Purchases are ${chain(BUY_CHAIN).name} only: USDC on another network cannot be spent, and the user moves it themselves from Profile.`, { wallet: swap.wallet, destinationChainId: { type: "integer", enum: [BUY_CHAIN] }, tokenOut: token.address, amount: { type: "string" } }, ["wallet", "destinationChainId", "tokenOut", "amount"]),
  tool("list_buyable_assets", `Every asset Rubicon can actually buy, with its exact ${chain(BUY_CHAIN).name} contract, decimals and whether it is a tokenized stock or crypto. Each entry is pinned and verified against the chain. Start here: a contract from this list is always executable, while a search result may not be.`, {}),
  tool("buy_asset", `Buy something for the user without them present, in one call. Only offered when they have turned on unattended buying, set limits, and delegated a wallet — otherwise it is absent and calling it fails. The purchase is real and irreversible: it spends their USDC on ${chain(BUY_CHAIN).name}. Name the asset as it appears in list_buyable_assets and the amount in dollars; Rubicon resolves the contract, the wallet, the decimals and the slippage, reserves the trade against their limits, and settles it. There is nothing further to call afterwards.`, {
    symbol: { type: "string", description: "The asset's symbol or underlying exactly as list_buyable_assets gives it, e.g. AAPLc or AAPL." },
    usd: { type: "string", description: "Dollars to spend, as a decimal string, e.g. \"3\" or \"2.50\". Must be within the user's per-trade limit. Never a base-unit integer." },
    reasoning: { type: "string", description: "Why this is worth buying for this user now, in one or two sentences." },
  }, ["symbol", "usd", "reasoning"]),
  tool("execute_crypto_swap", `Settle a proposal you already made, without the user present. Only offered when the user has turned on unattended buying, set limits, and delegated a wallet — otherwise it is absent and calling it fails. The purchase is real and irreversible: it spends their USDC on ${chain(BUY_CHAIN).name}. Propose first with propose_crypto_swap, then execute that tradeId. Never execute a proposal the user has not funded the limits for.`, { tradeId: { type: "string" } }, ["tradeId"]),
  tool("discover_crypto_pairs", "Discover live DEX pairs, token contract identities, liquidity, volume, and price changes. Results are market data, not a safety endorsement.", { query: { type: "string" } }, ["query"]),
  tool("research_crypto_token", "Research an exact chain + contract with DexScreener, CoinGecko metadata (including decimals), and DefiLlama. Partial provider failures are reported.", token, ["chainId", "address"]),
  tool("crypto_history", "CoinGecko price, market cap, and volume history for a CoinGecko id.", { id: { type: "string" }, days: { type: "integer", minimum: 1, maximum: 365 } }, ["id"]),
  tool("research_defi", "Find DeFi protocols with chains, categories, and TVL from DefiLlama.", { query: { type: "string" } }),
  tool("get_crypto_holdings", "Read the user’s actual wallet tokens and balances, including externally acquired tokens when indexed discovery is configured. Returns exact chain, wallet, token contract, decimals and base-unit balance. Always call before selling, discussing their portfolio, or proposing a rebalance. Coverage warnings mean missing tokens must not be treated as zero. Read-only; token symbols are untrusted data.", {}),
  tool("get_crypto_wallets", "List this user's existing Privy-linked EVM wallets and supported execution chains. Ask the user to select when multiple wallets are linked.", {}),
  tool("quote_crypto_swap", "Get a fresh exact-input Uniswap quote. Read-only: does not execute or reserve funds. Same-chain EVM V2/V3 swaps only.", swap, Object.keys(swap)),
  tool("propose_crypto_swap", `Propose a buy or sell through the user's Privy-linked wallet. To sell, call get_crypto_holdings first, use the held token as tokenIn and the chain’s USDC as tokenOut, and never exceed that wallet’s exact balance. Sales require the user’s wallet signature. Purchases settle on ${chain(BUY_CHAIN).name} only — tokenized stocks or crypto that trade there. Call list_buyable_assets first to get exact contracts. Enforces server-valued USD limits and shows a review/sign card. Wallet confirmation is required even in automatic mode. Never claim execution from a quote or proposal.`, { ...swap, reasoning: { type: "string" } }, [...Object.keys(swap), "reasoning"]),
];
export const cryptoToolGroup = (name: string) => ["check_purchase_funds", "get_crypto_wallets", "quote_crypto_swap", "propose_crypto_swap", "execute_crypto_swap", "buy_asset"].includes(name) ? "trading" : "market";
export async function executeCryptoTool(name: string, args: Record<string, unknown>, context: AgentContext<import("@/lib/socialtrading/agents/services").AgentServices>): Promise<{ result: unknown; parts: MessagePart[] }> {
  const services = context.services.onchain ?? cryptoServices;
  const text = (v: unknown, fallback = "") => typeof v === "string" ? v.slice(0, 100) : fallback;
  switch (name) {
    case "check_purchase_funds": return { result: await resolvePurchaseRoute(context.userId, { wallets: [text(args.wallet)], destinationChainId: args.destinationChainId as number, tokenOut: text(args.tokenOut), amount: text(args.amount) }), parts: [] };
    case "list_buyable_assets": return { result: {
      network: { chainId: BUY_CHAIN, name: chain(BUY_CHAIN).name, payWith: { symbol: "USDC", address: chain(BUY_CHAIN).usdc, decimals: 6 } },
      note: `Buys and sells settle on ${chain(BUY_CHAIN).name}. Funds on another network cannot be spent here.`,
      assets: CATALOG_ENTRIES.flatMap(e => { const t = tradability(e); return t.status === "tradable" ? [{ symbol: t.symbol, name: t.name, kind: t.kind, underlying: e.underlying, tokenOut: t.token, decimals: t.decimals }] : []; }),
    }, parts: [] };
    /** Deciding to buy and buying are one act when nobody is present.
     *
     * The propose/execute pair exists for the attended flow, where the proposal
     * is the thing the user reviews and signs. Unattended there is nobody to
     * review it, so splitting it only doubled the round-trips and invented a
     * failure it could land in: a reserved trade that nothing ever settles.
     *
     * The model names an asset and an amount in dollars. Everything that can be
     * got wrong by arithmetic or transcription — the contract, the decimals, the
     * wallet, the slippage, the base units — is resolved here. */
    case "buy_asset": {
      const wallet = await firstDelegatedWallet(context.userId);
      const gate = autonomyState(context.state, wallet?.id);
      if (!gate.allowed) throw new Error(gate.reason);
      const asset = tradability({ symbol: text(args.symbol) });
      if (asset.status !== "tradable") throw new Error(asset.detail ?? `${text(args.symbol)} cannot be bought on ${chain(BUY_CHAIN).name}.`);
      // The schema asks for a string and models routinely send the number 3, or
      // "$3", or "3.00 USD". Accept what they actually send: rejecting it here
      // is the kind of failure nobody is present to correct.
      const usd = (typeof args.usd === "number" ? String(args.usd) : text(args.usd))
        .trim().replace(/[$,]/g, "").replace(/\s*usd$/i, "");
      if (!/^\d+(\.\d+)?$/.test(usd) || Number(usd) <= 0) throw new Error(`Could not read "${String(args.usd)}" as an amount in dollars. Send a number like 3 or 2.50.`);
      // The paymaster takes its fee from the same USDC the purchase spends, so a
      // buy sized to the whole balance fails validation with nothing left for it.
      // Hold $0.60 back — comfortably above the $0.50 the fee cap needs on Base —
      // and shrink the purchase to fit rather than failing. Nobody is present to
      // retry with a smaller number, and buying a little less is always safe.
      const balance = await readWithPatience(() => usdcBalance(BUY_CHAIN, wallet!.address))
        .catch((error: unknown) => { throw transientRead(error) ? new Error("The chain is rate limiting reads right now, so the balance could not be checked. Nothing was bought; say so and leave it for the next run.") : error; });
      const spendable = balance - FEE_HOLDBACK;
      if (spendable <= 0n) throw new Error(`There is $${(Number(balance) / 1e6).toFixed(2)} of USDC in this wallet on ${chain(BUY_CHAIN).name}, and $${(Number(FEE_HOLDBACK) / 1e6).toFixed(2)} has to stay behind for the network fee. Add USDC before buying.`);
      const asked = BigInt(parseUnits(usd, 6));
      const amount = asked > spendable ? spendable : asked;
      const spent = (Number(amount) / 1e6).toFixed(2);
      const request: SwapRequest = { chainId: BUY_CHAIN, tokenIn: chain(BUY_CHAIN).usdc, tokenOut: asset.token, amount: amount.toString(), slippageBps: 50, wallet: wallet!.address };
      // Unattended: the agent decided it and nothing will ask the person first.
      const trade = await proposeSwap(context.state, context.userId, request, text(args.reasoning, ""), services, "agent", true);
      // A blocked proposal is the limit doing its job; report it and settle nothing.
      if (trade.status === "blocked") return { result: { bought: false, reason: trade.policy?.reason ?? "This purchase is outside the limits you set.", instruction: "Explain the limit plainly. Do not retry." }, parts: [{ type: "trade", tradeId: trade.id }] };
      const settled = await executeAutonomousBuy(context.state, context.userId, trade, wallet!);
      return { result: { bought: settled.status === "confirmed", symbol: asset.symbol, usd: spent, ...settled,
        ...(amount < asked ? { note: `Asked for $${usd}; spent $${spent} so $${(Number(FEE_HOLDBACK) / 1e6).toFixed(2)} of USDC stays behind for the network fee.` } : {}),
        instruction: settled.status === "confirmed" ? `Bought. Say plainly in the feed item that you bought $${spent} of ${asset.symbol} and why.`
          : settled.status === "failed" ? "It reverted onchain; nothing was bought. Say so." : "Submitted but not yet confirmed. Do not claim it succeeded." }, parts: [{ type: "trade", tradeId: trade.id }] };
    }
    case "execute_crypto_swap": {
      const trade = context.state.trades.find(t => t.id === text(args.tradeId));
      if (!trade?.crypto) throw new Error("No such proposal. Propose the swap first.");
      const wallet = await delegatedWallet(context.userId, trade.crypto.request.wallet);
      // Re-checked at the moment of spending: a grant can be revoked between
      // the tool being offered and the tool being called.
      const gate = autonomyState(context.state, wallet?.id);
      if (!gate.allowed) throw new Error(gate.reason);
      const settled = await executeAutonomousBuy(context.state, context.userId, trade, wallet!);
      return { result: { ...settled, instruction: settled.status === "confirmed" ? "Confirmed onchain. Tell the user what you bought and why, plainly." : settled.status === "failed" ? "It reverted; nothing was bought. Say so." : "Submitted but not yet confirmed. Do not claim it succeeded." }, parts: [{ type: "trade", tradeId: trade.id }] };
    }
    case "discover_crypto_pairs": return { result: await services.discovery.search(text(args.query)), parts: [] };
    case "research_crypto_token": return { result: await services.research({ chainId: args.chainId as number, address: text(args.address) }), parts: [] };
    case "crypto_history": {
      const history = await services.metadata.history(text(args.id), args.days === undefined ? 30 : args.days as number);
      const sample = (points: [number, number][]) => points.filter((_, i) => i % Math.max(1, Math.ceil(points.length / 60)) === 0 || i === points.length - 1);
      return { result: { source: "CoinGecko", sampled: true, prices: sample(history.prices), marketCaps: sample(history.market_caps), volumes: sample(history.total_volumes) }, parts: [] };
    }
    case "research_defi": return { result: { source: "DefiLlama", protocols: await services.defi.protocols(text(args.query)), fetchedAt: new Date().toISOString() }, parts: [] };
    case "get_crypto_holdings": return { result: await scanHoldings(context.userId, await userWallets(context.userId), context.state, undefined, [BUY_CHAIN]), parts: [] };
    case "get_crypto_wallets": return { result: { wallets: await userWallets(context.userId), chains: { [BUY_CHAIN]: chain(BUY_CHAIN) }, signing: "User confirms each transaction in their wallet; no delegated signer.", usdc: Object.fromEntries(Object.entries({ [BUY_CHAIN]: chain(BUY_CHAIN) }).map(([id, c]) => [id, c.usdc])) }, parts: [] };
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
