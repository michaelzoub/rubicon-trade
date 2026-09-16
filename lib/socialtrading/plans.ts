import type { Interest } from "./profile";
import { isThemeId } from "./themes";
import type { LearnedInterest } from "./types";

/**
 * Plan catalogue. Browser-safe: the UI reads it for counters and copy, the server reads it to
 * snapshot limits into `socialtrading_accounts`, and Postgres enforces that snapshot. Adding a plan
 * is a new entry here plus assigning `plan_id` on the account row; nothing else changes.
 */
export type PlanId = "free" | "plus" | "pro";
export type LimitKey = "follows" | "preferenceItems" | "learnedAssets" | "thesisChars" | "chats" | "agents" | "enabledAgents";
export type PlanLimits = Record<LimitKey, number>;
export type Plan = {
  id: PlanId;
  name: string;
  /** One line under the name on the plans page. No second sentence. */
  tagline: string;
  /** USD per month. `0` on free, and the plans page reads `0` as "no price line". */
  priceUsdMonthly: number;
  limits: PlanLimits;
  credits: {
    /** Granted once when the account is created. */
    startingMicros: number;
    /** Added each billing period on a paid plan. `0` means the plan never tops up. */
    monthlyMicros: number;
    /** Held per model call until OpenRouter reports the real cost. Also the minimum balance to start a call. */
    holdMicros: number;
  };
};

/** 1 USD = 1,000,000 micros. OpenRouter reports cost in fractional USD. */
export const MICROS_PER_USD = 1_000_000;

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Everything you need to start following the market.",
    priceUsdMonthly: 0,
    limits: { follows: 5, preferenceItems: 5, learnedAssets: 25, thesisChars: 1000, chats: 20, agents: 3, enabledAgents: 2 },
    credits: { startingMicros: 5 * MICROS_PER_USD, monthlyMicros: 0, holdMicros: 20_000 },
  },
  plus: {
    id: "plus",
    name: "Plus",
    tagline: "A sharper agent that remembers far more of you.",
    priceUsdMonthly: 5,
    limits: { follows: 25, preferenceItems: 15, learnedAssets: 250, thesisChars: 4000, chats: Infinity, agents: 5, enabledAgents: 3 },
    credits: { startingMicros: 5 * MICROS_PER_USD, monthlyMicros: 5 * MICROS_PER_USD, holdMicros: 50_000 },
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "The frontier models, and no ceiling on what it tracks.",
    priceUsdMonthly: 20,
    limits: { follows: Infinity, preferenceItems: Infinity, learnedAssets: Infinity, thesisChars: 10_000, chats: Infinity, agents: Infinity, enabledAgents: 10 },
    credits: { startingMicros: 22 * MICROS_PER_USD, monthlyMicros: 22 * MICROS_PER_USD, holdMicros: 150_000 },
  },
};

/** The ladder, cheapest first. The plans page renders in this order. */
export const PLAN_ORDER: PlanId[] = ["free", "plus", "pro"];

/** The raised card. Convention, not capability: the middle tier is the one most people should pick. */
export const FEATURED_PLAN: PlanId = "plus";

export const isPlanId = (id: unknown): id is PlanId => typeof id === "string" && id in PLANS;
export const DEFAULT_PLAN: Plan = PLANS.free;
export const planById = (id: unknown): Plan => (typeof id === "string" && id in PLANS ? PLANS[id as PlanId] : DEFAULT_PLAN);

/** Copy for one limit: what it is called and what the user can do when it is reached. */
export const LIMIT_COPY: Record<LimitKey, { noun: string; plural: string; remedy: string }> = {
  follows: { noun: "followed asset", plural: "followed assets", remedy: "Unfollow an asset in your profile to follow another." },
  preferenceItems: { noun: "item", plural: "items", remedy: "Remove an item from this list to add another." },
  learnedAssets: { noun: "learned asset", plural: "learned assets", remedy: "Forget a learned asset in your profile and your agent keeps learning." },
  thesisChars: { noun: "character", plural: "characters", remedy: "Shorten your point of view to fit." },
  chats: { noun: "chat", plural: "chats", remedy: "Delete an old chat to start a new one." },
  agents: { noun: "agent", plural: "agents", remedy: "Delete an agent to create another." },
  enabledAgents: { noun: "running agent", plural: "running agents", remedy: "Pause another agent first." },
};

export type LimitStatus = { key: LimitKey; used: number; limit: number; remaining: number; atLimit: boolean; nearLimit: boolean; unlimited: boolean };

/** Where the user stands against one cap. "Near" means one slot left or within 20%, whichever is larger. */
export function limitStatus(limits: PlanLimits, key: LimitKey, used: number): LimitStatus {
  const limit = limits[key];
  const unlimited = !Number.isFinite(limit);
  const remaining = unlimited ? Infinity : Math.max(0, limit - used);
  const nearBand = unlimited ? 0 : Math.max(1, Math.ceil(limit * .2));
  return { key, used, limit, remaining, unlimited, atLimit: !unlimited && used >= limit, nearLimit: !unlimited && used < limit && remaining <= nearBand };
}

export const followedAssets = (interests: Pick<Interest, "kind">[]) => interests.filter(i => i.kind === "stock" || i.kind === "crypto").length;
export const learnedAssets = (inferred: Pick<LearnedInterest, "id">[]) => inferred.filter(i => !isThemeId(i.id)).length;

/** `$4.83`; small positive balances show as `< $0.01` so a user never sees `$0.00` while calls still succeed. */
export function formatCredits(micros: number): string {
  if (micros <= 0) return "$0.00";
  if (micros < 10_000) return "< $0.01";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(micros / MICROS_PER_USD);
}

/** Serialises limits for the Postgres snapshot: `Infinity` becomes `null`, which SQL reads as "no cap". */
export function limitsSnapshot(limits: PlanLimits): Record<LimitKey, number | null> {
  return Object.fromEntries((Object.keys(limits) as LimitKey[]).map(k => [k, Number.isFinite(limits[k]) ? limits[k] : null])) as Record<LimitKey, number | null>;
}
export function limitsFromSnapshot(snapshot: unknown, fallback: PlanLimits): PlanLimits {
  if (!snapshot || typeof snapshot !== "object") return fallback;
  const s = snapshot as Record<string, unknown>;
  return Object.fromEntries((Object.keys(fallback) as LimitKey[]).map(k => [k, s[k] === null ? Infinity : typeof s[k] === "number" && Number.isFinite(s[k]) ? s[k] as number : fallback[k]])) as PlanLimits;
}
export const sameLimits = (a: PlanLimits, b: PlanLimits) => JSON.stringify(limitsSnapshot(a)) === JSON.stringify(limitsSnapshot(b));

/** What the client learns about the signed-in user's plan beside every state response. */
export type AccountSummary = {
  planId: PlanId;
  planName: string;
  limits: PlanLimits;
  credits: { balanceMicros: number; spentMicros: number; requests: number; holdMicros: number };
  /** Counts that span agents and therefore cannot be derived from one agent's state. */
  usage: { agents: number; enabledAgents: number; chats: number };
};

/** `5`, or `Unlimited` when a plan lifts the cap entirely. */
export const formatLimit = (value: number): string => (Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(value) : "Unlimited");

/** `$5`, `$20` — whole dollars, because every price on the ladder is one. */
export const formatPrice = (usd: number): string => `$${usd}`;
