import { describe, expect, it, vi } from "vitest";
import { defaultAgent } from "../agents/config";
import { cronSlot, dispatchScheduledRuns, isDue } from "./dispatcher";
import { emptyMemory, type DueAgent, type RunJob, type RunOutcome } from "./types";

const NOW = new Date("2026-09-15T10:31:12.000Z");
const due = (agentId: string, patch: Partial<DueAgent> = {}, cadenceMinutes = 30): DueAgent => ({ userId: "u", agentId, agent: { ...defaultAgent(agentId), enabled: true, notifications: { cadenceMinutes, threshold: "medium", maxPerDay: 3 } }, memory: emptyMemory(), lastStartedAt: null, ...patch });
const ok = (job: RunJob): RunOutcome => ({ runId: job.agentId, status: "succeeded", summary: "quiet" });

describe("dispatcher", () => {
  it("floors time to the slot and uses it as the idempotency key", () => {
    expect(cronSlot(NOW)).toBe("2026-09-15T10:30:00.000Z");
    expect(cronSlot(new Date("2026-09-15T10:59:59.000Z"))).toBe("2026-09-15T10:30:00.000Z");
  });
  it("honours each agent's cadence with tolerance for cron jitter", () => {
    expect(isDue(due("a"), NOW)).toBe(true);
    expect(isDue(due("a", { lastStartedAt: "2026-09-15T10:01:00.000Z" }, 30), NOW)).toBe(true);
    expect(isDue(due("a", { lastStartedAt: "2026-09-15T10:20:00.000Z" }, 30), NOW)).toBe(false);
    expect(isDue(due("a", { lastStartedAt: "2026-09-15T09:33:00.000Z" }, 60), NOW)).toBe(true);
    expect(isDue(due("a", { lastStartedAt: "2026-09-15T10:01:00.000Z" }, 60), NOW)).toBe(false);
  });
  it("runs due agents with bounded concurrency and isolates failures", async () => {
    let active = 0, peak = 0;
    const execute = vi.fn(async (job: RunJob) => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active--;
      if (job.agentId === "broken") throw new Error("boom");
      if (job.agentId === "failed") return { runId: null, status: "failed" as const, summary: "The run failed.", error: "provider down" };
      return ok(job);
    });
    const agents = [due("a"), due("broken"), due("failed"), due("d"), due("stale", { lastStartedAt: "2026-09-15T10:25:00.000Z" })];
    const report = await dispatchScheduledRuns({ store: { dueAgents: async () => agents }, execute, now: () => NOW, budgetMs: 600_000, concurrency: 2 });
    expect(report).toMatchObject({ slot: expect.any(String), considered: 5, started: 4, succeeded: 2, failed: 2, notDue: 1, deferred: 0 });
    expect(peak).toBeLessThanOrEqual(2);
    expect(execute.mock.calls.every(([job]) => job.trigger === "cron" && job.slot === report.slot)).toBe(true);
    expect(report.results.find(r => r.agentId === "broken")).toMatchObject({ status: "failed", error: "boom" });
    expect(report.results.find(r => r.agentId === "stale")).toMatchObject({ status: "not_due" });
  });
  it("defers runs that do not fit the invocation budget and times out slow runs", async () => {
    let clock = 0;
    const now = () => new Date(NOW.getTime() + clock);
    const execute = vi.fn(async (job: RunJob, signal: AbortSignal) => {
      clock += 40_000;
      if (job.agentId === "slow") await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
      return ok(job);
    });
    const report = await dispatchScheduledRuns({ store: { dueAgents: async () => [due("slow"), due("b"), due("c")] }, execute, now, budgetMs: 70_000, perRunTimeoutMs: 30, concurrency: 1 });
    expect(report.results.find(r => r.agentId === "slow")).toMatchObject({ status: "failed", error: "Run timed out." });
    expect(report.results.find(r => r.agentId === "b")).toMatchObject({ status: "succeeded" });
    expect(report.results.find(r => r.agentId === "c")).toMatchObject({ status: "deferred" });
    expect(report.deferred).toBe(1);
  });
});
