import type { PlanId } from "./plans";

/**
 * The models a plan may reach for. Browser-safe: the plans page reads it for the ladder, the server
 * reads `defaultModelForPlan` to pick what actually runs. Tiers are cumulative — a plan that includes
 * `frontier` includes everything below it — so a card can show one tier's models and still be honest
 * about what the plan unlocks overall.
 *
 * Every entry is tool-capable on OpenRouter. The agent's whole loop is tool calls, so a model without
 * tool support cannot run it, however good it reads on a pricing page.
 */
export type ModelTier = "fast" | "capable" | "frontier";

export type Model = {
  /** OpenRouter slug. This is what goes on the wire. */
  id: string;
  name: string;
  lab: string;
  tier: ModelTier;
  /** Context window in tokens, as OpenRouter reports it. */
  context: number;
  /** Published price in USD per million tokens. Shown for honesty; credits are charged at real cost. */
  usdPerMillion: { in: number; out: number };
};

/** Tiers from cheapest to most capable. Order is meaningful: it is the ladder. */
export const TIER_ORDER: ModelTier[] = ["fast", "capable", "frontier"];

export const TIER_COPY: Record<ModelTier, { name: string; blurb: string }> = {
  fast: { name: "Fast", blurb: "Quick answers and everyday checks." },
  capable: { name: "Capable", blurb: "Deeper reasoning across more of your history." },
  frontier: { name: "Frontier", blurb: "The strongest models these labs ship." },
};

export const MODELS: Model[] = [
  { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", lab: "OpenAI", tier: "fast", context: 1_047_576, usdPerMillion: { in: .4, out: 1.6 } },
  { id: "google/gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", lab: "Google", tier: "fast", context: 1_048_576, usdPerMillion: { in: .25, out: 1.5 } },

  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5", lab: "Anthropic", tier: "capable", context: 1_000_000, usdPerMillion: { in: 2, out: 10 } },
  { id: "openai/gpt-5.1", name: "GPT-5.1", lab: "OpenAI", tier: "capable", context: 400_000, usdPerMillion: { in: 1.25, out: 10 } },
  { id: "google/gemini-3.5-flash", name: "Gemini 3.5 Flash", lab: "Google", tier: "capable", context: 1_048_576, usdPerMillion: { in: 1.5, out: 9 } },

  { id: "anthropic/claude-opus-5", name: "Claude Opus 5", lab: "Anthropic", tier: "frontier", context: 1_000_000, usdPerMillion: { in: 5, out: 25 } },
  { id: "openai/gpt-5.5", name: "GPT-5.5", lab: "OpenAI", tier: "frontier", context: 1_050_000, usdPerMillion: { in: 5, out: 30 } },
  { id: "google/gemini-3.1-pro", name: "Gemini 3.1 Pro", lab: "Google", tier: "frontier", context: 1_048_576, usdPerMillion: { in: 2, out: 12 } },
  { id: "x-ai/grok-4.6", name: "Grok 4.6", lab: "xAI", tier: "frontier", context: 500_000, usdPerMillion: { in: 2, out: 6 } },
];

/** Which tiers a plan unlocks, cheapest first. Cumulative by construction. */
export function tiersForPlan(planId: PlanId): ModelTier[] {
  const top: Record<PlanId, ModelTier> = { free: "fast", plus: "capable", pro: "frontier" };
  return TIER_ORDER.slice(0, TIER_ORDER.indexOf(top[planId]) + 1);
}

/** Every model a plan may use, in ladder order. */
export function modelsForPlan(planId: PlanId): Model[] {
  const tiers = tiersForPlan(planId);
  return MODELS.filter(m => tiers.includes(m.tier));
}

export const modelsInTier = (tier: ModelTier): Model[] => MODELS.filter(m => m.tier === tier);

/** The highest tier a plan unlocks — what its card leads with. */
export const topTierForPlan = (planId: PlanId): ModelTier => tiersForPlan(planId).at(-1)!;

/**
 * What the agent actually calls for this plan. The best model in the plan's top tier, by output price
 * as a stand-in for capability. `SOCIALTRADING_MODEL` still wins when set, so a deployment can pin one
 * model without touching the catalogue.
 */
export function defaultModelForPlan(planId: PlanId): string {
  const top = modelsInTier(topTierForPlan(planId));
  return top.reduce((best, m) => (m.usdPerMillion.out > best.usdPerMillion.out ? m : best), top[0]).id;
}

/** Resolves the model for a request: the env pin first, then the plan's default. */
export const modelForPlan = (planId: PlanId): string => process.env.SOCIALTRADING_MODEL || defaultModelForPlan(planId);

export const modelById = (id: string): Model | undefined => MODELS.find(m => m.id === id);

/** `1M` / `400K`, for the one context figure a card shows. */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0M", "M");
  return `${Math.round(tokens / 1000)}K`;
}
