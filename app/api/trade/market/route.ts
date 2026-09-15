import { requestedAgent, authenticate, failure, HubError, loadState } from "@/lib/socialtrading/server";
import { agentServices } from "@/lib/socialtrading/agents/services";
import { personalize } from "@/lib/socialtrading/personalization";
export async function GET(request: Request) {
  try {
    const state = await loadState(await authenticate(request), requestedAgent(new URL(request.url).searchParams.get("agentId")));
    if (!state) throw new HubError(400, "Complete your profile first.");
    if (state.agent && !state.agent.capabilities.includes("market")) throw new HubError(403, "Market research is disabled for this agent.");
    const params = new URL(request.url).searchParams, kind = params.get("kind") ?? "stock", query = (params.get("q") ?? "").slice(0, 100), id = params.get("id");
    const days = [7, 30, 90, 365].includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
    const provider = kind === "crypto" ? agentServices.crypto : agentServices.stocks;
    const assets = id ? [await provider.detail(id, days)] : kind === "ipos" ? await agentServices.stocks.ipos() : kind === "trends" ? await (async () => {
      const results = await Promise.allSettled([agentServices.stocks.trending?.() ?? Promise.resolve([]), agentServices.crypto.trending()]);
      if (results.every(r => r.status === "rejected")) throw new HubError(503, "Trends are temporarily unavailable. Try again shortly.");
      return results.flatMap(r => r.status === "fulfilled" ? r.value : []);
    })() : await provider.search(query || (kind === "crypto" ? "" : ""));
    return Response.json({ assets: assets.map(a => personalize(a, state)).filter(a => id || (a.score ?? 0) > -5).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) });
  } catch (e) { return failure(e); }
}
