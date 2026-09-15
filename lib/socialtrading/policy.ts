import { limitsError, type InvestingProfile } from "./profile";
import type { TradeInitiator, TradeIntent } from "./types";

export type PolicyDecision = { allowed: boolean; reason: string; needsApproval?: boolean };

/** Statuses that hold or have spent money and therefore count toward the agent's windows. */
const ACTIVE: TradeIntent["status"][] = ["reserved", "submitted", "confirmed", "unknown"];

/** USD cents the agent has committed inside a rolling window. Trades the user
 * placed themselves never consume the agent's allowance. Crypto intents whose
 * calldata has been handed to a wallet (`issued`) stay counted until the chain
 * settles them, whatever their age: funds may still move. */
export function agentSpend(trades: TradeIntent[], window: number, now = Date.now()): number {
  return trades
    .filter(t => t.initiator !== "user" && ACTIVE.includes(t.status))
    .filter(t => (t.crypto?.phase === "issued" && t.status !== "confirmed") || Date.parse(t.createdAt) > now - window)
    .reduce((n, t) => n + Math.round(t.value * 100), 0);
}

/** Deterministic permission and limit checks. Runs on the server before any
 * order reaches a brokerage or wallet; the model is never consulted. Amounts
 * are compared in integer cents.
 *
 * Invariant for agent-initiated trades: with limits set, a trade is refused when
 * `value > perTrade`, when `value + spend(24h) > daily`, or when
 * `value + spend(7d) > weekly`, where spend covers every reserved, submitted,
 * unknown, or confirmed agent trade in the window.
 *
 * "Ask before acting" users may leave limits empty; "Act within my limits" users
 * must have valid limits. User-initiated trades skip the agent mode gate: the
 * user is deciding for themselves and still signs in their own wallet. */
export function tradePolicy(profile: InvestingProfile, value: number, trades: TradeIntent[], approved: boolean, now = Date.now(), initiator: TradeInitiator = "agent"): PolicyDecision {
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) return { allowed: false, reason: "Enter a positive USD value with at most two decimal places." };
  if (initiator === "user") return { allowed: true, reason: "You placed this yourself. Your agent’s mode and limits apply only to trades it proposes." };
  if (!profile.permissionConfigured || profile.permission === "notify") return { allowed: false, reason: "Your agent is in Notify me mode. It cannot place trades." };
  const hasLimits = [profile.limits.perTrade, profile.limits.daily, profile.limits.weekly].some(v => v.trim() !== "");
  if (profile.permission === "automatic" || hasLimits) {
    if (limitsError(profile.limits)) return { allowed: false, reason: profile.permission === "automatic" ? "Set valid per-trade, daily, and weekly limits before trading." : "Your saved limits are invalid. Fix them in your profile before trading." };
    const cents = Math.round(value * 100);
    if (cents > Math.round(Number(profile.limits.perTrade) * 100)) return { allowed: false, reason: `This exceeds your per-trade limit of $${Number(profile.limits.perTrade).toFixed(2)}.` };
    if (agentSpend(trades, 86400_000, now) + cents > Math.round(Number(profile.limits.daily) * 100)) return { allowed: false, reason: `This exceeds your rolling 24-hour limit of $${Number(profile.limits.daily).toFixed(2)}.` };
    if (agentSpend(trades, 7 * 86400_000, now) + cents > Math.round(Number(profile.limits.weekly) * 100)) return { allowed: false, reason: `This exceeds your rolling 7-day limit of $${Number(profile.limits.weekly).toFixed(2)}.` };
  }
  if (profile.permission === "approve" && !approved) return { allowed: false, needsApproval: true, reason: "Your approval is required." };
  return { allowed: true, reason: hasLimits ? "Within your saved permissions and limits." : "Within your saved permissions." };
}

/** What the agent could still spend right now, for display. Null when no limits are set. */
export function remainingAllowance(profile: InvestingProfile, trades: TradeIntent[], now = Date.now()): { daily: number; weekly: number; perTrade: number } | null {
  if (limitsError(profile.limits)) return null;
  const cents = (v: string) => Math.round(Number(v) * 100);
  return {
    perTrade: cents(profile.limits.perTrade) / 100,
    daily: Math.max(0, cents(profile.limits.daily) - agentSpend(trades, 86400_000, now)) / 100,
    weekly: Math.max(0, cents(profile.limits.weekly) - agentSpend(trades, 7 * 86400_000, now)) / 100,
  };
}
