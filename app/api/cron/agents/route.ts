import { dispatchScheduledRuns } from "@/lib/socialtrading/runtime/dispatcher";
import { executeRun, runtimeStore } from "@/lib/socialtrading/runtime/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel Pro allows up to 300s. The dispatcher stops launching runs before this elapses and reports what it deferred. */
export const maxDuration = 300;
const BUDGET_MS = (maxDuration - 30) * 1000;

/** Constant-time comparison so the secret cannot be probed byte by byte. */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header.length !== `Bearer ${secret}`.length) return false;
  let diff = 0;
  const expected = `Bearer ${secret}`;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

/** Vercel Cron entry point (`vercel.json`, every 30 minutes). Vercel sends `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET is not configured; scheduled runs are disabled." }, { status: 503 });
  if (!authorized(request)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const report = await dispatchScheduledRuns({ store: runtimeStore, execute: executeRun, budgetMs: BUDGET_MS, perRunTimeoutMs: 90_000, concurrency: 3 });
    console.info("[cron/agents]", JSON.stringify({ slot: report.slot, considered: report.considered, started: report.started, succeeded: report.succeeded, failed: report.failed, skipped: report.skipped, deferred: report.deferred, notDue: report.notDue, elapsedMs: report.elapsedMs }));
    return Response.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[cron/agents] dispatch failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Dispatch failed." }, { status: 500 });
  }
}
