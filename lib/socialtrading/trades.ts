import "server-only";
import type { InvestingProfile } from "./profile";
import { tradePolicy } from "./policy";
import { learn, recordEvent } from "./personalization";
import { brokerage, BrokerageNotConnected } from "./providers/brokerage";
import { HubError } from "./server";
import type { Asset, HubState, TradeIntent } from "./types";
import { DEFAULT_PLAN, type PlanLimits } from "./plans";

export const MAX_TRADES = 500;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** Creates an intent and runs the deterministic policy. Never touches the
 * brokerage unless the policy allows it outright (Act within my limits). */
export async function proposeTrade(state: HubState, userId: string, input: { asset: TradeIntent["asset"]; side: "buy" | "sell"; value: number; reasoning: string }, quote: Asset | null): Promise<TradeIntent> {
  if (input.asset.kind === "crypto") throw new HubError(400, "Use propose_crypto_swap with exact token addresses, chain, and base-unit amount to trade through your Privy wallet.");
  const at = new Date().toISOString();
  const value = Math.round(input.value * 100) / 100;
  const price = quote?.price ?? null;
  const exposure = state.trades.filter(t => t.asset.id === input.asset.id && ["reserved", "submitted", "confirmed", "unknown"].includes(t.status)).reduce((n, t) => n + (t.side === "buy" ? t.value : -t.value), 0);
  const decision = tradePolicy(state.profile, value, state.trades, false);
  const trade: TradeIntent = {
    id: crypto.randomUUID(), initiator: "agent", asset: input.asset, side: input.side, value,
    estimatedPrice: price, estimatedQuantity: price ? Math.round((value / price) * 1e6) / 1e6 : null,
    resultingExposure: Math.max(0, exposure + (input.side === "buy" ? value : -value)),
    createdAt: at, status: decision.allowed ? "reserved" : decision.needsApproval ? "approval_required" : "blocked",
    reasoning: input.reasoning.slice(0, 600), policy: { allowed: decision.allowed, reason: decision.reason, at },
  };
  state.trades.push(trade);
  if (state.trades.length > MAX_TRADES) {
    const protectedTrade = (t: TradeIntent) => !!t.crypto && (t.crypto.phase === "issued" || ["reserved", "approval_required"].includes(t.status));
    const removable = state.trades.filter(t => !protectedTrade(t)).slice(0, state.trades.length - MAX_TRADES);
    state.trades = state.trades.filter(t => !removable.includes(t));
  }
  recordEvent(state, "trade", `Proposed ${trade.side === "buy" ? "buying" : "selling"} ${trade.asset.symbol} for ${usd(value)}`, trade.status === "blocked" ? `Blocked: ${decision.reason}` : trade.status === "approval_required" ? "Waiting for your approval." : "Allowed within your limits.", trade.id);
  if (trade.status === "reserved") await submit(state, userId, trade);
  return trade;
}

export async function decideTrade(state: HubState, userId: string, tradeId: string, decision: "approved" | "rejected", limits: PlanLimits = DEFAULT_PLAN.limits) {
  const trade = state.trades.find(t => t.id === tradeId);
  if (!trade) throw new HubError(404, "This trade is no longer available.");
  if (trade.crypto) throw new HubError(400, "Use the crypto wallet confirmation flow for this swap.");
  if (trade.status !== "approval_required") throw new HubError(409, "This trade has already been decided.");
  const at = new Date().toISOString();
  trade.approval = { decision, at };
  if (decision === "rejected") {
    trade.status = "rejected";
    recordEvent(state, "trade", `You declined ${trade.side === "buy" ? "buying" : "selling"} ${trade.asset.symbol}`, undefined, trade.id);
    learn(state, "rejected", trade.asset.symbol, [], limits);
    return trade;
  }
  // Re-check limits at approval time; other trades may have landed since.
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true);
  trade.policy = { allowed: policy.allowed, reason: policy.reason, at };
  if (!policy.allowed) { trade.status = "blocked"; recordEvent(state, "trade", `Approved, but blocked: ${policy.reason}`, undefined, trade.id); return trade; }
  trade.status = "reserved";
  recordEvent(state, "trade", `You approved ${trade.side === "buy" ? "buying" : "selling"} ${trade.asset.symbol} for ${usd(trade.value)}`, undefined, trade.id);
  learn(state, "approved", trade.asset.symbol, [], limits);
  await submit(state, userId, trade);
  return trade;
}

/** Sends an approved, policy-cleared intent to the brokerage and records
 * exactly what came back. A trade is only "confirmed" on an explicit fill. */
async function submit(state: HubState, userId: string, trade: TradeIntent) {
  const at = new Date().toISOString();
  try {
    if (state.agent && state.agent.id !== "default") throw new BrokerageNotConnected();
    const result = await brokerage.placeOrder(userId, { symbol: trade.asset.symbol, kind: trade.asset.kind, side: trade.side, notionalUsd: trade.value, clientId: trade.id });
    trade.brokerage = { provider: brokerage.provider, status: result.status, orderId: result.orderId, at, detail: result.detail };
    trade.status = result.status === "filled" ? "confirmed" : result.status === "rejected" ? "failed" : result.status === "submitted" ? "submitted" : "unknown";
    recordEvent(state, "trade", `Robinhood ${result.status === "filled" ? "filled" : result.status === "rejected" ? "rejected" : "received"} your ${trade.asset.symbol} order`, result.detail, trade.id);
  } catch (error) {
    if (error instanceof BrokerageNotConnected) {
      trade.brokerage = { provider: brokerage.provider, status: "not_connected", at, detail: "Robinhood isn’t connected. The order is approved and waiting; connect Robinhood to send it." };
      recordEvent(state, "trade", `Waiting for Robinhood to be connected before sending ${trade.asset.symbol}`, undefined, trade.id);
    } else {
      trade.status = "unknown";
      trade.brokerage = { provider: brokerage.provider, status: "unknown", at, detail: error instanceof Error ? error.message : "Robinhood did not respond." };
      recordEvent(state, "trade", `Robinhood did not confirm your ${trade.asset.symbol} order`, trade.brokerage.detail, trade.id);
    }
  }
}

export function describeLimits(profile: InvestingProfile) {
  if (profile.permission === "notify") return "Notify me: the agent never places trades.";
  const limits = profile.limits.perTrade ? ` Limits: $${profile.limits.perTrade} per trade, $${profile.limits.daily} daily, $${profile.limits.weekly} weekly.` : "";
  return profile.permission === "approve" ? `Ask before acting: every trade needs explicit approval.${limits}` : `Act within my limits.${limits}`;
}
