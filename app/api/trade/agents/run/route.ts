import { assertCredits, loadAccount } from "@/lib/socialtrading/account";
import { authenticate, bodyOf, failure, HubError, loadState, requestedAgent } from "@/lib/socialtrading/server";
import { executeRun, runtimeStore } from "@/lib/socialtrading/runtime/production";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Manual trigger from the agents page: the same runtime the cron uses, recorded as a `manual` run and metered the same way. */
export async function POST(request: Request) {
  try {
    const userId = await authenticate(request), body = await bodyOf(request);
    const agentId = requestedAgent(body.agentId);
    if (!(await loadState(userId, agentId))) throw new HubError(404, "Agent not found.");
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "Your agent isn’t configured on this deployment yet.");
    const account = await loadAccount(userId);
    assertCredits(account);
    const outcome = await executeRun({ userId, agentId, trigger: "manual", slot: null }, AbortSignal.timeout((maxDuration - 10) * 1000), { limits: account.limits, holdMicros: account.credits.holdMicros });
    const [state, runs, fresh] = await Promise.all([loadState(userId, agentId), runtimeStore.recentRuns(userId, agentId, 8), loadAccount(userId)]);
    return Response.json({ outcome, state, runs, account: fresh }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
