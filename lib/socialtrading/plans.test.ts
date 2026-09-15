import { describe, expect, it } from "vitest";
import { formatCredits, limitStatus, limitsFromSnapshot, limitsSnapshot, PLANS } from "./plans";
import { exceeds, profileViolation } from "./limits";
import { appendMessages, chatTitle, latestChat, normalizeChats } from "./chats";
import type { Message } from "./types";

const limits = PLANS.free.limits;

describe("limitStatus", () => {
  it("flags near and at the cap", () => {
    expect(limitStatus(limits, "follows", 3)).toMatchObject({ remaining: 2, nearLimit: false, atLimit: false });
    expect(limitStatus(limits, "follows", 4)).toMatchObject({ remaining: 1, nearLimit: true, atLimit: false });
    expect(limitStatus(limits, "follows", 5)).toMatchObject({ remaining: 0, nearLimit: false, atLimit: true });
    expect(limitStatus(limits, "learnedAssets", 20)).toMatchObject({ nearLimit: true });
    expect(limitStatus(limits, "learnedAssets", 19)).toMatchObject({ nearLimit: false });
  });
  it("treats Infinity as unlimited and round-trips it through the snapshot as null", () => {
    const paid = { ...limits, chats: Infinity };
    expect(limitStatus(paid, "chats", 900)).toMatchObject({ unlimited: true, atLimit: false, nearLimit: false });
    expect(limitsSnapshot(paid).chats).toBeNull();
    expect(limitsFromSnapshot(limitsSnapshot(paid), limits).chats).toBe(Infinity);
    expect(limitsFromSnapshot({ follows: "5" }, limits).follows).toBe(5);
  });
});

describe("credits formatting", () => {
  it("never shows a zero balance for a positive amount", () => {
    expect(formatCredits(5_000_000)).toBe("$5.00");
    expect(formatCredits(4_834_120)).toBe("$4.83");
    expect(formatCredits(120)).toBe("< $0.01");
    expect(formatCredits(0)).toBe("$0.00");
    expect(formatCredits(-500)).toBe("$0.00");
  });
});

describe("profileViolation", () => {
  const interest = (symbol: string, kind: "stock" | "crypto" | "custom" = "stock") => ({ id: symbol, symbol, name: symbol, kind });
  const base = { profile: { thesis: "short", interests: [] as ReturnType<typeof interest>[] }, dislikes: [] as string[], preferences: [] as string[] };
  it("blocks only increases past the cap", () => {
    const full = { ...base, profile: { ...base.profile, interests: ["A", "B", "C", "D", "E"].map(s => interest(s)) } };
    expect(profileViolation(base, full, limits)).toBeNull();
    const over = { ...base, profile: { ...base.profile, interests: [...full.profile.interests, interest("F")] } };
    expect(profileViolation(full, over, limits)).toMatchObject({ key: "follows", limit: 5 });
    expect(profileViolation(over, over, limits)).toBeNull();
    const shrunk = { ...base, profile: { ...base.profile, interests: over.profile.interests.slice(0, 6) } };
    expect(profileViolation({ ...over, profile: { ...over.profile, interests: [...over.profile.interests, interest("G")] } }, shrunk, limits)).toBeNull();
  });
  it("counts custom ideas against the section but not against follows", () => {
    const ideas = { ...base, profile: { ...base.profile, interests: ["a", "b", "c", "d", "e"].map(s => interest(s, "custom")) } };
    expect(profileViolation(base, ideas, limits)).toBeNull();
    const sixth = { ...ideas, profile: { ...ideas.profile, interests: [...ideas.profile.interests, interest("f", "custom")] } };
    expect(profileViolation(ideas, sixth, limits)).toMatchObject({ key: "preferenceItems" });
  });
  it("caps thesis length and each preference list, with a remedy in the message", () => {
    expect(profileViolation(base, { ...base, profile: { ...base.profile, thesis: "x".repeat(1001) } }, limits)?.message).toMatch(/1,000 characters.*Shorten/);
    expect(profileViolation(base, { ...base, preferences: ["1", "2", "3", "4", "5", "6"] }, limits)?.message).toMatch(/Things you care about.*Remove an item/);
    expect(profileViolation(null, { ...base, dislikes: ["1", "2", "3", "4", "5", "6"] }, limits)).toMatchObject({ key: "preferenceItems" });
    expect(exceeds("chats", limits, 20, 21)?.message).toMatch(/up to 20 chats\. Delete an old chat/);
  });
});

describe("chats", () => {
  const msg = (role: "user" | "assistant", text: string, at: string): Message => ({ id: `${role}-${at}`, role, at, parts: [{ type: "text", text }] });
  it("migrates a legacy conversation into one titled chat", () => {
    const chats = normalizeChats({ messages: [msg("user", "what happened with VRT today?", "2026-09-14T10:00:00Z"), msg("assistant", "Up 3%.", "2026-09-14T10:00:05Z")] });
    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: "default", title: "what happened with VRT today?", createdAt: "2026-09-14T10:00:00Z", updatedAt: "2026-09-14T10:00:05Z" });
    expect(chats[0].messages).toHaveLength(2);
    expect(normalizeChats({})[0]).toMatchObject({ id: "default", title: "New chat", messages: [] });
  });
  it("titles from the first user message and tracks the latest chat", () => {
    const [chat] = normalizeChats({});
    appendMessages(chat, [msg("user", "  Find me   something related to nuclear power and the grid, please and thank you  ", "2026-09-15T09:00:00Z")], "2026-09-15T09:00:00Z");
    expect(chat.title).toBe("Find me something related to nuclear power and the grid, pl…");
    expect(chatTitle("")).toBe("New chat");
    const older = { ...chat, id: "older", updatedAt: "2026-09-01T00:00:00Z" };
    expect(latestChat([older, chat]).id).toBe(chat.id);
  });
});
