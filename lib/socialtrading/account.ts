import "server-only";
import type { CreditLedger } from "./credits";
import { DEFAULT_PLAN, limitsFromSnapshot, limitsSnapshot, planById, sameLimits, type AccountSummary } from "./plans";
import { creditsError, database, HubError } from "./server";

type AccountRow = { plan_id: string; limits: unknown; credits_micros: number | string; agents: number; enabled_agents: number; chats: number; spent_micros: number | string; requests: number };

/**
 * The signed-in user's plan, balance, and cross-agent usage in one round trip. Creates the account on first sight
 * with the default plan and its starting credits. When the catalogue changed since the snapshot was taken, the
 * snapshot is refreshed so Postgres enforces what the server believes.
 */
export async function loadAccount(userId: string): Promise<AccountSummary> {
  const { data, error } = await database().rpc("socialtrading_account_get", { p_user_id: userId, p_plan_id: DEFAULT_PLAN.id, p_limits: limitsSnapshot(DEFAULT_PLAN.limits), p_credits: DEFAULT_PLAN.credits.startingMicros });
  const row = (Array.isArray(data) ? data[0] : data) as AccountRow | undefined;
  if (error || !row) throw new HubError(503, "Your plan could not be loaded. Please retry.");
  const plan = planById(row.plan_id);
  let limits = limitsFromSnapshot(row.limits, plan.limits);
  if (!sameLimits(limits, plan.limits)) {
    const { error: drift } = await database().from("socialtrading_accounts").update({ limits: limitsSnapshot(plan.limits), updated_at: new Date().toISOString() }).eq("user_id", userId).eq("plan_id", plan.id);
    if (!drift) limits = plan.limits;
  }
  return {
    planId: plan.id, planName: plan.name, limits,
    credits: { balanceMicros: Number(row.credits_micros), spentMicros: Number(row.spent_micros), requests: row.requests, holdMicros: plan.credits.holdMicros },
    usage: { agents: row.agents, enabledAgents: row.enabled_agents, chats: row.chats },
  };
}

/** Refuses up front when the balance cannot cover one model call, before any stream opens. */
export function assertCredits(account: AccountSummary) {
  if (account.credits.balanceMicros < account.credits.holdMicros) throw creditsError();
}

/** Supabase-backed ledger. Each method is one RPC; the RPCs are atomic and idempotent (see the migration). */
export const supabaseLedger: CreditLedger = {
  async balance(userId) {
    const { data, error } = await database().from("socialtrading_accounts").select("credits_micros").eq("user_id", userId).maybeSingle();
    if (error) { console.error("[credits] balance", error.message); return null; }
    return data ? Number(data.credits_micros) : null;
  },
  async reserve(scope, holdMicros) {
    const { data, error } = await database().rpc("socialtrading_credits_reserve", { p_user_id: scope.userId, p_agent_id: scope.agentId, p_source: scope.source, p_ref: scope.ref, p_hold: holdMicros });
    if (error) { console.error("[credits] reserve", error.message); throw new HubError(503, "Credits could not be checked. Please retry."); }
    return (data as string | null) ?? null;
  },
  async settle(entryId, usage, charge) {
    const { data, error } = await database().rpc("socialtrading_credits_settle", { p_entry: entryId, p_cost: charge.costMicros, p_prompt: usage.promptTokens, p_completion: usage.completionTokens, p_model: usage.model, p_request_id: usage.requestId, p_cost_source: charge.costSource });
    if (error) { console.error("[credits] settle", entryId, error.message); return null; }
    return data === null ? null : Number(data);
  },
  async release(entryId) {
    const { data, error } = await database().rpc("socialtrading_credits_release", { p_entry: entryId });
    if (error) { console.error("[credits] release", entryId, error.message); return null; }
    return data === null ? null : Number(data);
  },
};
