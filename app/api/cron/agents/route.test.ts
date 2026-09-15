import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn(async () => ({ slot: "s", considered: 0, started: 0, succeeded: 0, failed: 0, skipped: 0, deferred: 0, notDue: 0, results: [], elapsedMs: 1 })) }));
vi.mock("@/lib/socialtrading/runtime/dispatcher", () => ({ dispatchScheduledRuns: dispatch }));
vi.mock("@/lib/socialtrading/runtime/production", () => ({ executeRun: vi.fn(), runtimeStore: {} }));
import { GET } from "./route";
const get = (authorization?: string) => GET(new Request("http://localhost/api/cron/agents", { headers: authorization ? { authorization } : {} }));
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "s3cret-value"); });
afterEach(() => vi.unstubAllEnvs());
it("only dispatches for the configured cron secret", async () => {
  expect((await get()).status).toBe(401);
  expect((await get("Bearer wrong-secret")).status).toBe(401);
  expect((await get("Bearer s3cret-valu")).status).toBe(401);
  expect(dispatch).not.toHaveBeenCalled();
  const ok = await get("Bearer s3cret-value");
  expect(ok.status).toBe(200);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ budgetMs: expect.any(Number), concurrency: 3 }));
});
it("fails closed when no secret is configured", async () => {
  vi.stubEnv("CRON_SECRET", "");
  expect((await get("Bearer ")).status).toBe(503);
  expect(dispatch).not.toHaveBeenCalled();
});
