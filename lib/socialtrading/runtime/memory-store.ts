import { HubError } from "../server";
import type { HubState } from "../types";
import { emptyMemory, type AgentMemory, type DueAgent, type NotificationInput, type RunRecord, type RuntimeStore } from "./types";

/**
 * In-memory RuntimeStore with the same invariants as the Postgres schema: one running run per agent, one run per
 * scheduled slot, unique dedupe keys, compare-and-swap state saves. Used by tests and the fixture preview.
 */
export class MemoryRuntimeStore implements RuntimeStore {
  states = new Map<string, HubState>();
  memories = new Map<string, AgentMemory>();
  runs: (RunRecord & { userId: string; agentId: string; leaseUntil: number })[] = [];
  notifications: (NotificationInput & { id: string; createdAt: string })[] = [];
  constructor(private clock: () => Date = () => new Date()) {}
  private key = (userId: string, agentId: string) => `${userId}/${agentId}`;
  seed(userId: string, state: HubState) { this.states.set(this.key(userId, state.agent!.id), structuredClone(state)); }

  async dueAgents(): Promise<DueAgent[]> {
    return [...this.states.entries()].filter(([, s]) => s.agent?.enabled).map(([key, s]) => {
      const [userId, agentId] = key.split("/");
      const last = this.runs.filter(r => r.userId === userId && r.agentId === agentId && r.trigger === "cron").sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
      return { userId, agentId, agent: s.agent!, memory: this.memories.get(key) ?? emptyMemory(), lastStartedAt: last?.startedAt ?? null };
    });
  }
  async claimRun(job: Parameters<RuntimeStore["claimRun"]>[0], leaseSeconds: number) {
    const now = this.clock().getTime();
    for (const run of this.runs) if (run.userId === job.userId && run.agentId === job.agentId && run.status === "running" && run.leaseUntil < now) { run.status = "failed"; run.error = "Lease expired before the run finished."; run.finishedAt = new Date(now).toISOString(); }
    if (this.runs.some(r => r.userId === job.userId && r.agentId === job.agentId && r.status === "running")) return null;
    if (job.slot && this.runs.some(r => r.userId === job.userId && r.agentId === job.agentId && r.slot === job.slot)) return null;
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ id, userId: job.userId, agentId: job.agentId, trigger: job.trigger, slot: job.slot, status: "running", startedAt: new Date(now).toISOString(), finishedAt: null, summary: null, decision: null, error: null, notified: false, leaseUntil: now + leaseSeconds * 1000 });
    return id;
  }
  async finishRun(runId: string, result: Parameters<RuntimeStore["finishRun"]>[1]) {
    const run = this.runs.find(r => r.id === runId);
    if (!run) return;
    Object.assign(run, { status: result.status, finishedAt: this.clock().toISOString(), summary: result.summary, decision: result.decision ?? null, error: result.error ?? null, notified: result.notified });
  }
  async loadState(userId: string, agentId: string) { const s = this.states.get(this.key(userId, agentId)); return s ? structuredClone(s) : null; }
  async saveState(userId: string, state: HubState) {
    const key = this.key(userId, state.agent!.id), current = this.states.get(key);
    if (!current || current.revision !== state.revision) throw new HubError(409, "Your workspace changed in another tab. Refresh before trying again.");
    const next = structuredClone({ ...state, revision: state.revision + 1 });
    this.states.set(key, next);
    return next;
  }
  async readMemory(userId: string, agentId: string) { return structuredClone(this.memories.get(this.key(userId, agentId)) ?? emptyMemory()); }
  async writeMemory(userId: string, agentId: string, memory: AgentMemory) { this.memories.set(this.key(userId, agentId), structuredClone(memory)); }
  async notificationsSince(userId: string, agentId: string, since: Date) { return this.notifications.filter(n => n.userId === userId && n.agentId === agentId && Date.parse(n.createdAt) >= since.getTime()).length; }
  async insertNotification(input: NotificationInput) {
    if (input.dedupeKey && this.notifications.some(n => n.userId === input.userId && n.agentId === input.agentId && n.dedupeKey === input.dedupeKey)) return "duplicate" as const;
    this.notifications.push({ ...input, id: `n-${this.notifications.length + 1}`, createdAt: this.clock().toISOString() });
    return "inserted" as const;
  }
  async recentRuns(userId: string, agentId: string, limit: number) {
    return this.runs.filter(r => r.userId === userId && r.agentId === agentId).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)).slice(0, limit).map(({ userId: _u, agentId: _a, leaseUntil: _l, ...run }) => run);
  }
}
