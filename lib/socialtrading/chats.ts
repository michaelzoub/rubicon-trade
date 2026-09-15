import type { Chat, Message } from "./types";

/** Legacy conversations migrate into a chat with this id so clients can address it before the next save. */
export const LEGACY_CHAT_ID = "default";
export const CHAT_ID = /^(default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const TITLE_MAX = 60;

export function chatTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "New chat";
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1).trimEnd()}…` : line;
}

export function newChat(at = new Date().toISOString(), id = crypto.randomUUID()): Chat {
  return { id, title: "New chat", createdAt: at, updatedAt: at, messages: [] };
}

/** Fills defaults for state stored before chats existed and guarantees at least one chat. */
export function normalizeChats(state: { chats?: unknown; messages?: unknown }, at = new Date().toISOString()): Chat[] {
  const legacy = Array.isArray(state.messages) ? state.messages as Message[] : [];
  const raw = Array.isArray(state.chats) ? state.chats as Partial<Chat>[] : [];
  const chats: Chat[] = raw.filter(c => c && typeof c === "object" && typeof c.id === "string").map(c => ({
    id: c.id!, title: typeof c.title === "string" && c.title.trim() ? c.title : "New chat",
    createdAt: typeof c.createdAt === "string" ? c.createdAt : at, updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : at,
    messages: Array.isArray(c.messages) ? c.messages as Message[] : [],
  }));
  if (!chats.length) {
    const first = legacy[0]?.parts.find(p => p.type === "text");
    const created = legacy[0]?.at ?? at, updated = legacy.at(-1)?.at ?? at;
    chats.push({ id: LEGACY_CHAT_ID, title: first && first.type === "text" && legacy[0].role === "user" ? chatTitle(first.text) : legacy.length ? "Earlier conversation" : "New chat", createdAt: created, updatedAt: updated, messages: legacy });
  }
  return chats;
}

/** Most recently active chat: where background reach-outs land and what the client opens by default. */
export function latestChat(chats: Chat[]): Chat {
  return [...chats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

/** Appends a turn to a chat, titling it from the first user message. */
export function appendMessages(chat: Chat, messages: Message[], at = new Date().toISOString()) {
  const firstUser = chat.messages.length === 0 ? messages.find(m => m.role === "user") : undefined;
  const text = firstUser?.parts.find(p => p.type === "text");
  if (text && text.type === "text") chat.title = chatTitle(text.text);
  chat.messages.push(...messages);
  chat.updatedAt = at;
}
