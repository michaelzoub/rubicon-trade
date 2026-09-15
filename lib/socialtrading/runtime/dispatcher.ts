import type { DueAgent, RunJob, RunOutcome, RuntimeStore } from "./types";

export const SLOT_MINUTES = 30;
/** Cron jitter tolerance: an hourly agent still runs when the cron fires at :31 instead of :30. */
const CADENCE_TOLERANCE_MS = 5 * 60_000;

/** The scheduled slot a moment belongs to, e.g. 2026-09-15T10:30:00.000Z. Reused as the idempotency key. */
export function cronSlot(now: Date, minutes = SLOT_MINUTES): string {
  const step = minutes * 60_000;
  return new Date(Math.floor(now.getTime() / step) * step).toISOString();
}

/** Whether an agent's cadence says it should wake up now. */
export function isDue(agent: DueAgent, now: Date): boolean {
  if (!agent.lastStartedAt) return true;
  const elapsed = now.getTime() - Date.parse(agent.lastStartedAt);
  return elapsed >= agent.agent.notifications.cadenceMinutes * 60_000 - CADENCE_TOLERANCE_MS;
}

export type DispatchResult = { userId: string; agentId: string; status: RunOutcome["status"] | "deferred" | "not_due"; summary?: string; error?: string; ms?: number };
export type DispatchReport = {
  slot: string; considered: number; started: number;
  succeeded: number; failed: number; skipped: number; deferred: number; notDue: number;
  results: DispatchResult[]; elapsedMs: number;
};

export type DispatchOptions = {
  store: Pick<RuntimeStore, "dueAgents">;
  /** Runs one job. In production this is `runBackgroundAgent`; a queue worker can replace it with an enqueue. */
  execute: (job: RunJob, signal: AbortSignal) => Promise<RunOutcome>;
  now?: () => Date;
  /** Wall-clock budget for this invocation. New runs stop launching when less than one run's timeout remains. */
  budgetMs: number;
  perRunTimeoutMs?: number;
  concurrency?: number;
  slot?: string;
};

/**
 * One cron tick. Loads enabled agents, filters by cadence, and runs them with bounded concurrency inside the
 * invocation budget. Every run is isolated: a failure or timeout is recorded and the next agent still runs.
 * Runs that do not fit the budget are reported as deferred; the next slot picks them up.
 */
export async function dispatchScheduledRuns(options: DispatchOptions): Promise<DispatchReport> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().getTime();
  const slot = options.slot ?? cronSlot(now());
  const perRun = options.perRunTimeoutMs ?? 90_000;
  const deadline = startedAt + options.budgetMs;
  const agents = await options.store.dueAgents();
  const results: DispatchResult[] = [];
  const queue: DueAgent[] = [];
  for (const agent of agents) {
    if (isDue(agent, now())) queue.push(agent);
    else results.push({ userId: agent.userId, agentId: agent.agentId, status: "not_due" });
  }
  const started = { count: 0 };
  async function worker() {
    for (;;) {
      const agent = queue.shift();
      if (!agent) return;
      if (now().getTime() + perRun > deadline) { results.push({ userId: agent.userId, agentId: agent.agentId, status: "deferred", summary: "Out of time this slot." }); continue; }
      started.count++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("Run timed out.")), perRun);
      const begun = now().getTime();
      try {
        const outcome = await Promise.race([
          options.execute({ userId: agent.userId, agentId: agent.agentId, trigger: "cron", slot }, controller.signal),
          new Promise<RunOutcome>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Run timed out.")), { once: true })),
        ]);
        results.push({ userId: agent.userId, agentId: agent.agentId, status: outcome.status, summary: outcome.summary, error: outcome.error, ms: now().getTime() - begun });
      } catch (error) {
        results.push({ userId: agent.userId, agentId: agent.agentId, status: "failed", error: error instanceof Error ? error.message : "The run failed.", ms: now().getTime() - begun });
      } finally { clearTimeout(timer); }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 3, queue.length || 1)) }, worker));
  const count = (status: DispatchResult["status"]) => results.filter(r => r.status === status).length;
  return { slot, considered: agents.length, started: started.count, succeeded: count("succeeded"), failed: count("failed"), skipped: count("skipped"), deferred: count("deferred"), notDue: count("not_due"), results, elapsedMs: now().getTime() - startedAt };
}
