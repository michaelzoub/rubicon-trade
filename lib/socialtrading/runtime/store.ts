import "server-only";
import { normalizeAgent } from "../agents/config";
import { database, HubError, loadState, saveState } from "../server";
import { emptyMemory, type AgentMemory, type RuntimeStore, type RunRecord } from "./types";

function memoryOf(value: unknown): AgentMemory {
  const base = emptyMemory();
  if (!value || typeof value !== "object") return base;
  const m = value as Partial<AgentMemory>;
  return {
    notes: Array.isArray(m.notes) ? m.notes.filter((n): n is string => typeof n === "string").slice(0, 12) : [],
    watched: m.watched && typeof m.watched === "object" ? m.watched : {},
    lastSummary: typeof m.lastSummary === "string" ? m.lastSummary : undefined,
    lastRunAt: typeof m.lastRunAt === "string" ? m.lastRunAt : undefined,
    lastNotifiedAt: typeof m.lastNotifiedAt === "string" ? m.lastNotifiedAt : undefined,
  };
}

/** Supabase-backed persistence for scheduled runs. Reuses the hub's state load/save so revisions stay consistent. */
export const supabaseRuntimeStore: RuntimeStore = {
  async dueAgents() {
    const { data, error } = await database().rpc("socialtrading_agents_due");
    if (error) throw new HubError(503, "Enabled agents could not be loaded.");
    return ((data ?? []) as { user_id: string; agent_id: string; agent: unknown; memory: unknown; last_started_at: string | null }[])
      .map(row => ({ userId: row.user_id, agentId: row.agent_id, agent: normalizeAgent(row.agent, row.agent_id, true), memory: memoryOf(row.memory), lastStartedAt: row.last_started_at }));
  },
  async claimRun(job, leaseSeconds) {
    const { data, error } = await database().rpc("socialtrading_agent_run_claim", { p_user_id: job.userId, p_agent_id: job.agentId, p_trigger: job.trigger, p_slot: job.slot, p_lease_seconds: leaseSeconds });
    if (error) throw new HubError(503, "The run could not be claimed.");
    return (data as string | null) ?? null;
  },
  async finishRun(runId, result) {
    const { error } = await database().from("socialtrading_agent_runs").update({ status: result.status, finished_at: new Date().toISOString(), summary: result.summary.slice(0, 1000), decision: result.decision ?? null, error: result.error?.slice(0, 1000) ?? null, notified: result.notified }).eq("id", runId);
    if (error) console.error("[runtime] finishRun", runId, error.message);
  },
  loadState: (userId, agentId) => loadState(userId, agentId),
  saveState: (userId, state) => saveState(userId, state),
  async readMemory(userId, agentId) {
    const { data, error } = await database().from("socialtrading_agents").select("memory").eq("user_id", userId).eq("agent_id", agentId).maybeSingle();
    if (error) throw new HubError(503, "Agent memory could not be loaded.");
    return memoryOf(data?.memory);
  },
  async writeMemory(userId, agentId, memory) {
    const { error } = await database().from("socialtrading_agents").update({ memory }).eq("user_id", userId).eq("agent_id", agentId);
    if (error) console.error("[runtime] writeMemory", agentId, error.message);
  },
  async notificationsSince(userId, agentId, since) {
    const { count, error } = await database().from("socialtrading_notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("agent_id", agentId).gte("created_at", since.toISOString());
    if (error) throw new HubError(503, "Notifications could not be counted.");
    return count ?? 0;
  },
  async insertNotification(input) {
    const { error } = await database().from("socialtrading_notifications").insert({ user_id: input.userId, agent_id: input.agentId, run_id: input.runId, title: input.title, body: input.body, relevance: input.relevance, dedupe_key: input.dedupeKey, parts: input.parts });
    if (error?.code === "23505") return "duplicate";
    if (error) throw new HubError(503, "The notification could not be saved.");
    return "inserted";
  },
  async recentRuns(userId, agentId, limit) {
    const { data, error } = await database().from("socialtrading_agent_runs").select("id,trigger,slot,status,started_at,finished_at,summary,decision,error,notified").eq("user_id", userId).eq("agent_id", agentId).order("started_at", { ascending: false }).limit(limit);
    if (error) throw new HubError(503, "Recent runs could not be loaded.");
    return (data ?? []).map((r): RunRecord => ({ id: r.id, trigger: r.trigger, slot: r.slot, status: r.status, startedAt: r.started_at, finishedAt: r.finished_at, summary: r.summary, decision: r.decision, error: r.error, notified: r.notified }));
  },
};
