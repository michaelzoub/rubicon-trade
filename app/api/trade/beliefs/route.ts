import { buildGraph } from "@/lib/socialtrading/memory-graph";
import { treePlan, treeState } from "@/lib/socialtrading/belief-tree";
import { askJev, jevModel } from "@/lib/socialtrading/jev";
import { authenticate, bodyOf, failure, HubError, loadState, requestedAgent } from "@/lib/socialtrading/server";

export const runtime = "nodejs";

/**
 * Scores one chapter of a worldview with Jev.
 *
 * Only the chapter being looked at is scored, not all hundred of them: the
 * client asks for a frame when it settles on one and keeps the answer, so
 * dragging through time costs one call per chapter actually read.
 *
 * The response is advisory. When Jev cannot be reached, `source` comes back
 * `"local"` with no answers and the client draws the same tree from the
 * strengths it already holds, so the page never depends on this route.
 */
export async function POST(request: Request) {
  try {
    const userId = await authenticate(request);
    const body = await bodyOf(request);
    if (body.frameId !== undefined && (typeof body.frameId !== "string" || body.frameId.length > 200)) throw new HubError(400, "Invalid chapter.");
    const state = await loadState(userId, requestedAgent(body.agentId));
    if (!state) throw new HubError(404, "Agent not found.");

    const frames = buildGraph(state);
    const frame = (body.frameId ? frames.find(f => f.id === body.frameId) : undefined) ?? frames.at(-1);
    if (!frame) throw new HubError(404, "Nothing recorded yet.");

    const plan = treePlan(frame, state.profile.themes ?? []);
    if (!Object.keys(plan.questions).length) return Response.json({ frameId: frame.id, answers: {}, source: "local", model: jevModel() });

    const answers = await askJev(
      treeState({
        thesis: state.profile.thesis,
        watching: state.profile.interests.map(i => ({ symbol: i.symbol ?? i.name, name: i.name })),
        learned: state.inferred.map(i => ({ id: i.id, confidence: i.confidence, weight: i.weight, count: i.count })),
        decisions: state.trades
          .filter(t => t.status === "confirmed")
          .slice(-25)
          .map(t => ({ side: t.side, symbol: t.asset.symbol, reasoning: t.reasoning })),
      }),
      plan.questions,
      request.signal,
    );

    return Response.json(
      { frameId: frame.id, answers: answers ?? {}, source: answers ? "jev" : "local", model: jevModel() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
