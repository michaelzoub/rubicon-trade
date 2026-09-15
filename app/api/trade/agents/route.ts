import { loadAccount } from "@/lib/socialtrading/account";
import { assertWithin, authenticate, bodyOf, deleteAgent, failure, HubError, insertAgent, listAgents, requestedAgent, setAgentEnabled } from "@/lib/socialtrading/server";
import { agentConfig, defaultAgent } from "@/lib/socialtrading/agents/config";
import { newChat } from "@/lib/socialtrading/chats";
import { exceeds, profileViolation } from "@/lib/socialtrading/limits";
import { newProfile } from "@/lib/socialtrading/profile";
import type { HubState } from "@/lib/socialtrading/types";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const userId = await authenticate(request);
    const [agents, account] = await Promise.all([listAgents(userId), loadAccount(userId)]);
    return Response.json({ agents, account }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const userId = await authenticate(request), body = await bodyOf(request);
    const account = await loadAccount(userId), limits = account.limits;
    let agent;
    try { agent = agentConfig(body, defaultAgent(crypto.randomUUID())); } catch (e) { throw new HubError(400, (e as Error).message); }
    if (typeof body.thesis !== "string" || !body.thesis.trim() || body.thesis.length > 4000) throw new HubError(400, "Give this agent an investing thesis.");
    // Plan caps first, in words; Postgres re-checks the same caps under a per-user lock on insert.
    assertWithin(exceeds("agents", limits, account.usage.agents, account.usage.agents + 1, "Your plan") ?? exceeds("chats", limits, account.usage.chats, account.usage.chats + 1, "Your plan"));
    const profile = { ...newProfile(userId), thesis: body.thesis.trim(), permissionConfigured: true, step: 5 as const, completedAt: new Date().toISOString() };
    assertWithin(profileViolation(null, { profile, dislikes: [], preferences: [] }, limits));
    // New agents never start enabled; the user turns scheduled runs on deliberately.
    agent.enabled = false;
    const state: HubState = { agent, revision: 0, profile, dislikes: [], preferences: [], inferred: [], signals: [], chats: [newChat()], trades: [], events: [{ id: crypto.randomUUID(), at: agent.createdAt, kind: "agent", text: `Created ${agent.name}` }] };
    await insertAgent(userId, state, limits);
    return Response.json({ state, account: await loadAccount(userId) }, { status: 201 });
  } catch (e) { return failure(e); }
}
/** Turns scheduled runs on or off for one agent. Works for agents other than the selected one, so no revision is needed. */
export async function PATCH(request: Request) {
  try {
    const userId = await authenticate(request), body = await bodyOf(request);
    if (typeof body.enabled !== "boolean") throw new HubError(400, "Invalid request.");
    const account = await loadAccount(userId);
    await setAgentEnabled(userId, requestedAgent(body.agentId), body.enabled, account.limits);
    const [agents, fresh] = await Promise.all([listAgents(userId), loadAccount(userId)]);
    return Response.json({ agents, account: fresh });
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request) {
  try {
    const userId = await authenticate(request);
    const agentId = requestedAgent(new URL(request.url).searchParams.get("agentId"));
    await deleteAgent(userId, agentId);
    const [agents, account] = await Promise.all([listAgents(userId), loadAccount(userId)]);
    return Response.json({ agents, account });
  } catch (e) { return failure(e); }
}
