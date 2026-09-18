import { assertCredits, loadAccount, supabaseLedger } from "@/lib/socialtrading/account";
import { requestedAgent, requestedChat, authenticate, bodyOf, failure, HubError, loadState, saveState } from "@/lib/socialtrading/server";
import { runAgent } from "@/lib/socialtrading/agent/run";
import { reviewProfile } from "@/lib/socialtrading/profile-review";
import { appendMessages, latestChat } from "@/lib/socialtrading/chats";
import { brokerage } from "@/lib/socialtrading/providers/brokerage";
import type { AccountSummary } from "@/lib/socialtrading/plans";
import type { ChatEvent, HubState, Message } from "@/lib/socialtrading/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const frame = (event: ChatEvent) => `data: ${JSON.stringify(event)}\n\n`;

/** One conversational turn inside one chat. The user message and the agent's reply, together
 * with every profile or trade change the tools made, persist in one save so the client never
 * sees a half-applied turn. Credits are held per model round and settled to OpenRouter's cost. */
export async function POST(request: Request) {
  let userId: string, text: string, revision: number, agentId: string, chatId: string | null, account: AccountSummary, state: HubState;
  try {
    userId = await authenticate(request);
    const body = await bodyOf(request);
    text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
    revision = Number(body.revision);
    agentId = requestedAgent(body.agentId);
    chatId = requestedChat(body.chatId);
    if (!text) throw new HubError(400, "Say something first.");
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "Your agent isn’t configured on this deployment yet.");
    const loaded = await loadState(userId, agentId).catch(() => null);
    if (!loaded) throw new HubError(400, "Complete your profile first.");
    state = loaded;
    if (revision !== state.revision) throw new HubError(409, "Your workspace changed. Refresh before continuing.");
    if (chatId && !state.chats.some(c => c.id === chatId)) throw new HubError(404, "This chat no longer exists.");
    account = await loadAccount(userId);
    assertCredits(account);
  } catch (e) { return failure(e); }

  const chat = chatId ? state.chats.find(c => c.id === chatId)! : latestChat(state.chats);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatEvent) => controller.enqueue(encoder.encode(frame(event)));
      const at = new Date().toISOString();
      const user: Message = { id: crypto.randomUUID(), role: "user", at, parts: [{ type: "text", text }], status: "done" };
      const assistant: Message = { id: crypto.randomUUID(), role: "assistant", at: new Date().toISOString(), parts: [], status: "streaming" };
      emit({ type: "message", id: assistant.id, at: assistant.at });
      try {
        // Refresh brokerage connectivity lazily so trade cards describe reality.
        if (agentId === "default" && (!state.brokerage?.checkedAt || Date.parse(state.brokerage.checkedAt) < Date.now() - 300_000)) {
          const status = await brokerage.status(userId).catch(() => null);
          if (status) state.brokerage = { provider: brokerage.provider, connected: status.connected, buyingPower: status.buyingPower, checkedAt: status.checkedAt };
        }
        assistant.parts = await runAgent({ state, chat, userId, text, emit, signal: request.signal, ledger: supabaseLedger, assistantId: assistant.id, limits: account.limits, holdMicros: account.credits.holdMicros, planId: account.planId });
        if (!assistant.parts.some(p => p.type === "text" || p.type === "notice")) assistant.parts.push({ type: "text", text: "Here’s what I found." });
        assistant.status = "done";
      } catch (error) {
        const message = error instanceof Error ? error.message : "Your agent hit a problem.";
        assistant.parts.push({ type: "notice", text: message });
        assistant.status = "error";
        emit({ type: "error", message });
      }
      appendMessages(chat, [user, assistant]);
      try {
        await reviewProfile(state, userId, account);
        const saved = await saveState(userId, state, account.limits);
        emit({ type: "state", state: saved });
      } catch (error) {
        emit({ type: "error", message: error instanceof HubError ? error.message : "This turn could not be saved." });
      }
      // The balance moved; tell the client without another round trip.
      const fresh = await loadAccount(userId).catch(() => null);
      if (fresh) emit({ type: "account", account: fresh });
      emit({ type: "done" });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
