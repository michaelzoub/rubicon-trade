import "server-only";
import { cryptoServices } from "./services";
import { ownedWallet } from "./wallet";
import { address, chain, CHAINS, NATIVE, parseUnits, swapRequest } from "./chains";
import { buildSwapBatch, gaslessChain } from "./batch";
import { tradePolicy } from "@/lib/socialtrading/policy";
import { recordEvent } from "@/lib/socialtrading/personalization";
import type { HubState, TradeInitiator, TradeIntent } from "@/lib/socialtrading/types";
import type { SwapRequest, TokenDisplay } from "./types";

/** A proposal that was never signed goes stale: quotes, prices, and the user's intent all move. */
export const PROPOSAL_TTL = 24 * 3600_000;
const usd = (n: number) => `$${n.toFixed(2)}`;

async function describe(services: typeof cryptoServices, chainId: number, token: string): Promise<TokenDisplay> {
  if (token === NATIVE) return { symbol: chain(chainId).nativeSymbol, decimals: 18 };
  try { const p = await services.defi?.price({ chainId, address: token }); if (p) return { symbol: p.symbol || "token", decimals: Number.isInteger(p.decimals) ? p.decimals! : null }; } catch { /* display only */ }
  return { symbol: "token", decimals: null };
}

/** Creates a swap intent and runs the deterministic policy. The wallet must
 * belong to the user; the quote is read-only. Agent proposals in Act mode
 * reserve their allowance immediately; every swap still needs the user's
 * wallet signature because no delegated signer exists. */
export async function proposeSwap(state: HubState, userId: string, input: SwapRequest, reasoning: string, services = cryptoServices, initiator: TradeInitiator = "agent") {
  const request = swapRequest(input); await ownedWallet(userId, request.wallet);
  const [quote, value, tokenIn, tokenOut] = await Promise.all([
    services.execution.quote(request),
    services.valuation.value({ chainId: request.chainId, address: request.tokenIn }, request.amount),
    describe(services, request.chainId, request.tokenIn), describe(services, request.chainId, request.tokenOut),
  ]);
  const policy = tradePolicy(state.profile, value, state.trades, false, Date.now(), initiator), at = new Date().toISOString();
  const status: TradeIntent["status"] = policy.allowed ? "reserved" : policy.needsApproval ? "approval_required" : "blocked";
  const detail = status === "blocked" ? `Blocked: ${policy.reason}` : initiator === "user" ? (gaslessChain(request.chainId) ? "Review and sign with your wallet when you’re ready. The network fee comes out of your USDC." : "Review and sign with your wallet when you’re ready. Network fees are additional.") : status === "reserved" ? "Within your agent’s limits and reserved against them. It still settles only when you sign in your wallet." : "Waiting for you to review and sign in your wallet. Network fees are additional.";
  const trade: TradeIntent = { id: crypto.randomUUID(), initiator, asset: { id: `${request.chainId}:${request.tokenOut}`, symbol: tokenOut.symbol.toUpperCase(), name: `${tokenOut.symbol.toUpperCase()} on ${chain(request.chainId).name}`, kind: "crypto" }, side: "buy", value, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, createdAt: at, reasoning: reasoning.slice(0, 600), policy: { ...policy, at }, status,
    crypto: { request, outputAmount: quote.outputAmount, minimumOutput: quote.minimumOutput, expiresAt: quote.expiresAt, phase: "ready", detail, display: { tokenIn, tokenOut } } };
  state.trades.push(trade);
  recordEvent(state, "trade", `${initiator === "user" ? "You set up" : "Proposed"} a Uniswap swap for ${usd(value)} of ${trade.asset.symbol} on ${chain(request.chainId).name}`, detail, trade.id);
  return trade;
}

/** User-initiated swap from human units. Decimals come from the valuation
 * provider, never from the client, and the amount is converted exactly. */
export async function userSwap(state: HubState, userId: string, input: Record<string, unknown>, services = cryptoServices) {
  const chainId = Number(input.chainId); chain(chainId);
  const tokenIn = address(input.tokenIn), tokenOut = address(input.tokenOut), wallet = address(input.wallet);
  const slippageBps = input.slippageBps === undefined ? 50 : Number(input.slippageBps);
  if (typeof input.amount !== "string") throw new Error("Enter an amount to spend.");
  let decimals: number | null = tokenIn === NATIVE ? 18 : null;
  if (decimals === null) { try { const p = await services.defi.price({ chainId, address: tokenIn }); if (Number.isInteger(p.decimals)) decimals = p.decimals!; } catch { /* fall through */ } }
  if (decimals === null) { try { const m = await services.metadata.contract({ chainId, address: tokenIn }); const d = m.detail_platforms?.[CHAINS[chainId as keyof typeof CHAINS].gecko]?.decimal_place; if (Number.isInteger(d)) decimals = d!; } catch { /* fall through */ } }
  if (decimals === null) throw new Error("The decimals of the token you’re paying with couldn’t be verified. Pay with USDC or the chain’s native token.");
  const amount = parseUnits(input.amount, decimals);
  return proposeSwap(state, userId, { chainId, tokenIn, tokenOut, wallet, amount, slippageBps }, typeof input.note === "string" ? input.note.slice(0, 600) : "Placed by you.", services, "user");
}

/** Call only from an authenticated user action. The route MUST save the reservation before returning calldata. */
export async function prepareSwap(state: HubState, userId: string, trade: TradeIntent) {
  const c = trade.crypto;
  if (!c || c.phase !== "ready" || !["approval_required", "reserved"].includes(trade.status)) throw new Error("This transaction was already issued or cannot be executed. Check its status.");
  if (Date.parse(trade.createdAt) < Date.now() - PROPOSAL_TTL) throw new Error("This proposal is more than a day old. Ask for a fresh one so the quote and limits are current.");
  if (trade.initiator !== "user" && state.agent && !state.agent.capabilities.includes("trading")) throw new Error("Trading is disabled for this agent.");
  await ownedWallet(userId, c.request.wallet);
  // Verify RPC setup before a wallet can submit anything.
  const { rpc } = await import("./rpc");
  if (BigInt(await rpc<string>(c.request.chainId, "eth_chainId", [])) !== BigInt(c.request.chainId)) throw new Error("RPC network mismatch.");
  const value = await cryptoServices.valuation.value({ chainId: c.request.chainId, address: c.request.tokenIn }, c.request.amount);
  if (value > trade.value) throw new Error("The USD input value increased. Ask for a new swap proposal.");
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed) throw new Error(policy.reason);
  const quote = await cryptoServices.execution.quote(c.request);
  if (BigInt(quote.minimumOutput) < BigInt(c.minimumOutput)) throw new Error("The quote moved below your minimum output. Ask for a new proposal.");
  const transaction = await cryptoServices.execution.swap(quote);
  // One signature covers the whole trade: any Permit2 allowance it still needs,
  // then the swap that spends it. The user never signs an approval on its own and
  // never pays for one separately.
  const batch = await buildSwapBatch(c.request, transaction);
  const at = new Date().toISOString();
  trade.approval = { decision: "approved", at }; trade.policy = { ...policy, at };
  trade.status = "unknown"; trade.createdAt = at;
  c.phase = "issued"; c.step = "swap"; c.transaction = transaction; c.batch = batch; c.hash = undefined; c.userOpHash = undefined;
  c.expiresAt = quote.expiresAt;
  c.detail = batch.paymaster
    ? "Waiting for your signature. The network fee comes out of your USDC, so you don’t need ETH."
    : "Swap sent to your wallet for signature. Until the chain confirms it, its reservation stays active.";
  recordEvent(state, "trade", "Uniswap swap sent to your wallet for confirmation", undefined, trade.id);
  return batch;
}
