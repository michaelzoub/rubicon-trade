import { loadAccount } from "@/lib/socialtrading/account";
import { agentConfig, defaultAgent } from "@/lib/socialtrading/agents/config";
import { newChat } from "@/lib/socialtrading/chats";
import { assertWithin, requestedAgent, requestedChat, authenticate, bodyOf, failure, HubError, initialize, loadState, saveState } from "@/lib/socialtrading/server";
import { exceeds, profileViolation } from "@/lib/socialtrading/limits";
import { readProfile, limitsError, PERMISSIONS } from "@/lib/socialtrading/profile";
import { learn, recordEvent } from "@/lib/socialtrading/personalization";
import { followedAssets } from "@/lib/socialtrading/plans";
import { decideTrade } from "@/lib/socialtrading/trades";
import type { SignalAction } from "@/lib/socialtrading/types";
export const runtime = "nodejs";
const SIGNALS: SignalAction[] = ["opened", "ignored", "dismissed", "followup", "watched", "removed", "approved", "rejected"];
const shortStrings = (list: unknown, max = 50, length = 200) => Array.isArray(list) && list.length <= max && list.every(s => typeof s === "string" && s.length <= length);

export async function GET(request: Request) {
  try {
    const userId = await authenticate(request);
    const [state, account] = await Promise.all([loadState(userId, requestedAgent(new URL(request.url).searchParams.get("agentId"))), loadAccount(userId)]);
    return Response.json({ state, account }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const userId = await authenticate(request), body = await bodyOf(request);
    const account = await loadAccount(userId), limits = account.limits;
    let state = await loadState(userId, requestedAgent(body.agentId));
    if (!state && (body.action !== "initialize" || requestedAgent(body.agentId) !== "default")) throw new HubError(404, "Agent not found.");
    if (!state) { const created = await initialize(userId, body.profile, limits); return Response.json({ state: created, account: await loadAccount(userId) }); }
    if (body.action === "initialize") return Response.json({ state, account });
    if (body.revision !== state.revision) throw new HubError(409, "Your workspace changed. Refresh before editing.");
    let chatId: string | undefined;
    if (body.action === "agent") {
      try { state.agent = agentConfig(body.config, state.agent ?? defaultAgent()); } catch (e) { throw new HubError(400, (e as Error).message); }
      // The agents page saves thesis, watchlist, mode, and limits in the same request as the configuration.
      const changed: string[] = [];
      const before = { profile: { thesis: state.profile.thesis, interests: state.profile.interests }, dislikes: state.dislikes, preferences: state.preferences };
      let thesis = state.profile.thesis, interests = state.profile.interests;
      if (body.thesis !== undefined) {
        if (typeof body.thesis !== "string" || !body.thesis.trim() || body.thesis.length > 4000) throw new HubError(400, "Give this agent an investing thesis.");
        thesis = body.thesis.trim();
      }
      if (body.interests !== undefined) {
        interests = readProfile(JSON.stringify({ ...state.profile, interests: body.interests }), userId).interests;
        if (!Array.isArray(body.interests) || interests.length !== body.interests.length) throw new HubError(400, "Check the watchlist entries.");
      }
      assertWithin(profileViolation(before, { ...before, profile: { thesis, interests } }, limits));
      if (thesis !== state.profile.thesis) { state.profile.thesis = thesis; changed.push("thesis"); }
      if (interests.map(i => i.id).join() !== state.profile.interests.map(i => i.id).join()) { state.profile.interests = interests; changed.push("watchlist"); }
      if (body.permission !== undefined || body.limits !== undefined) {
        const permission = body.permission ?? state.profile.permission, tradeLimits = body.limits ?? state.profile.limits;
        if (!Object.hasOwn(PERMISSIONS, permission) || !tradeLimits || typeof tradeLimits !== "object" || ![tradeLimits.perTrade, tradeLimits.daily, tradeLimits.weekly].every((v: unknown) => typeof v === "string" && v.length <= 20)) throw new HubError(400, "Check the agent mode and limits.");
        if (permission === "automatic" && limitsError(tradeLimits)) throw new HubError(400, limitsError(tradeLimits)!);
        if (permission !== state.profile.permission) changed.push("agent mode");
        if (JSON.stringify(tradeLimits) !== JSON.stringify(state.profile.limits)) changed.push("limits");
        state.profile.permission = permission; state.profile.limits = { perTrade: tradeLimits.perTrade, daily: tradeLimits.daily, weekly: tradeLimits.weekly }; state.profile.permissionConfigured = true;
      }
      recordEvent(state, "agent", `Updated ${state.agent.name} settings`, changed.length ? `Changed ${changed.join(", ")}.` : undefined);
    } else if (body.action === "profile") {
      const profile = readProfile(JSON.stringify({ ...body.profile, userId }), userId);
      if (!profile.completedAt || (profile.permission === "automatic" && limitsError(profile.limits))) throw new HubError(400, "Check your thesis, mode, and spending limits.");
      if (!shortStrings(body.dislikes) || !shortStrings(body.preferences)) throw new HubError(400, "Keep preferences to 50 short entries.");
      const before = state.profile;
      assertWithin(profileViolation(state, { profile, dislikes: body.dislikes, preferences: body.preferences }, limits));
      const changed = [
        before.thesis !== profile.thesis ? "thesis" : "", before.themes.join() !== profile.themes.join() ? "themes" : "",
        before.interests.map(i => i.id).join() !== profile.interests.map(i => i.id).join() ? "watchlist" : "",
        before.permission !== profile.permission ? "agent mode" : "", JSON.stringify(before.limits) !== JSON.stringify(profile.limits) ? "limits" : "",
        state.dislikes.join() !== body.dislikes.join() ? "things to show less" : "", state.preferences.join() !== body.preferences.join() ? "things you care about" : "",
      ].filter(Boolean);
      state.profile = profile; state.dislikes = body.dislikes; state.preferences = body.preferences;
      recordEvent(state, "profile", changed.length ? `You updated your ${changed.join(", ")}` : "You saved your profile", "Edited by you in your profile. Explicit preferences always outrank what the agent infers.");
    } else if (body.action === "signal") {
      if (!SIGNALS.includes(body.signal) || typeof body.target !== "string" || body.target.length > 100) throw new HubError(400, "Invalid interaction.");
      const themes = shortStrings(body.themes, 20, 40) ? body.themes as string[] : [];
      if (body.signal === "watched") {
        if (!["stock", "crypto"].includes(body.kind) || !/^[A-Za-z0-9.\-]{1,100}$/.test(body.target)) throw new HubError(400, "Invalid asset.");
        const symbol = typeof body.symbol === "string" ? body.symbol.slice(0, 15) : body.target;
        if (!state.profile.interests.some(i => i.id === body.target || i.symbol === symbol)) {
          const follows = followedAssets(state.profile.interests), items = state.profile.interests.length;
          assertWithin(exceeds("follows", limits, follows, follows + 1, "Following") ?? exceeds("preferenceItems", limits, items, items + 1, "“Paying attention to”"));
          if (items >= 50) throw new HubError(400, "Remove an asset before watching another.");
          state.profile.interests.push({ id: body.target, name: typeof body.name === "string" ? body.name.slice(0, 100) : symbol, symbol, kind: body.kind });
          recordEvent(state, "profile", `Added ${symbol} to what you’re watching`);
        }
      }
      learn(state, body.signal as SignalAction, body.target, themes, limits);
      if (body.signal === "removed") {
        const removed = state.profile.interests.find(i => i.id === body.target || i.symbol === body.target);
        state.profile.interests = state.profile.interests.filter(i => i !== removed);
        if (removed) recordEvent(state, "profile", `Removed ${removed.symbol || removed.name} from what you’re watching`);
      }
    } else if (body.action === "forget") {
      if (typeof body.target !== "string") throw new HubError(400, "Invalid request.");
      state.inferred = state.inferred.filter(i => i.id !== body.target);
      recordEvent(state, "profile", `You cleared what I’d inferred about ${body.target.slice(0, 100)}`);
    } else if (body.action === "trade") {
      if (typeof body.tradeId !== "string" || !["approved", "rejected"].includes(body.decision)) throw new HubError(400, "Invalid request.");
      if (state.agent && !state.agent.capabilities.includes("trading")) throw new HubError(403, "Trading is disabled for this agent.");
      await decideTrade(state, userId, body.tradeId, body.decision, limits);
    } else if (body.action === "chat") {
      if (body.op === "create") {
        // Chats are counted across every agent; Postgres re-checks under a per-user lock when the state saves.
        assertWithin(exceeds("chats", limits, account.usage.chats, account.usage.chats + 1, "Your plan"));
        const chat = newChat();
        state.chats.push(chat); chatId = chat.id;
      } else if (body.op === "delete") {
        const target = requestedChat(body.chatId);
        if (!target || !state.chats.some(c => c.id === target)) throw new HubError(404, "This chat no longer exists.");
        state.chats = state.chats.filter(c => c.id !== target);
        // An agent always has somewhere to talk; an empty replacement costs the same slot the deleted chat held.
        if (!state.chats.length) state.chats.push(newChat());
        recordEvent(state, "agent", "You deleted a chat", "Its messages are gone; what the agent learned and changed in your profile stays.");
      } else throw new HubError(400, "Unknown chat action.");
    } else throw new HubError(400, "Unknown action.");
    state = await saveState(userId, state, limits);
    return Response.json({ state, account: body.action === "chat" ? await loadAccount(userId) : account, ...(chatId ? { chatId } : {}) });
  } catch (e) { return failure(e); }
}
