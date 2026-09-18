import { expect, it, vi } from "vitest";
import { sseParser } from "./client";
import { reduceChatEvent } from "./hub-provider";
import type { ChatEvent, Message } from "@/lib/socialtrading/types";

it("parses server-sent events split across chunks", () => {
  const events: ChatEvent[] = [];
  const parser = sseParser(e => events.push(e));
  parser.push('data: {"type":"text","te');
  parser.push('xt":"Hel"}\n\ndata: {"type":"text","text":"lo"}\n\nnot json\n\ndata: {"type":"done"}\n\n');
  expect(events).toEqual([{ type: "text", text: "Hel" }, { type: "text", text: "lo" }, { type: "done" }]);
});

it("reduces streamed events into a single assistant message", () => {
  let message: Message = { id: "pending", role: "assistant", at: "", parts: [], status: "streaming" };
  const feed: ChatEvent[] = [
    { type: "message", id: "m9", at: "2026-09-14T00:00:00Z" },
    { type: "text", text: "Noted. " }, { type: "text", text: "Nuclear is in." },
    { type: "part", part: { type: "profile_update", changes: [{ field: "preferences", label: "Things you care about", after: "nuclear" }] } },
    { type: "text", text: "Two names fit." },
    { type: "done" },
  ];
  for (const event of feed) message = reduceChatEvent(message, event);
  expect(message.id).toBe("m9");
  expect(message.status).toBe("done");
  expect(message.parts.map(p => p.type)).toEqual(["text", "profile_update", "text"]);
  expect((message.parts[0] as { text: string }).text).toBe("Noted. Nuclear is in.");
  expect(vi.isMockFunction(reduceChatEvent)).toBe(false);
});

it("takes back prose the agent retracted once its tool answered", () => {
  let message: Message = { id: "pending", role: "assistant", at: "", parts: [], status: "streaming" };
  const feed: ChatEvent[] = [
    { type: "text", text: "You don’t hold " }, { type: "text", text: "any AAPLc." },
    { type: "retract", text: "You don’t hold any AAPLc." },
    { type: "text", text: "You hold 0.0084 AAPLc." },
    { type: "done" },
  ];
  for (const event of feed) message = reduceChatEvent(message, event);
  expect(message.parts).toEqual([{ type: "text", text: "You hold 0.0084 AAPLc." }]);
});
