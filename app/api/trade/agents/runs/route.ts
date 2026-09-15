import { authenticate, failure, requestedAgent } from "@/lib/socialtrading/server";
import { runtimeStore } from "@/lib/socialtrading/runtime/production";

export const runtime = "nodejs";

/** Recent wake-ups for one agent, newest first, for the agents page. */
export async function GET(request: Request) {
  try {
    const userId = await authenticate(request);
    const agentId = requestedAgent(new URL(request.url).searchParams.get("agentId"));
    return Response.json({ runs: await runtimeStore.recentRuns(userId, agentId, 8) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
