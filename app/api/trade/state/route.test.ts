import { beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "@/app/preview/fixture";
import type { HubState } from "@/lib/socialtrading/types";
import type { AccountSummary } from "@/lib/socialtrading/plans";
import { defaultAgent } from "@/lib/socialtrading/agents/config";

/** The state route against an in-memory workspace. Plan checks run in words here; Postgres re-checks them on save. */
const db = vi.hoisted(() => ({ state: null as HubState | null, account: null as AccountSummary | null, saved: [] as HubState[] }));
vi.mock("@/lib/socialtrading/server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/socialtrading/server")>(),
  authenticate: async () => "owner",
  loadState: async () => (db.state ? structuredClone(db.state) : null),
  saveState: async (_u: string, state: HubState) => { db.saved.push(structuredClone(state)); db.state = { ...structuredClone(state), revision: state.revision + 1 }; return db.state; },
}));
vi.mock("@/lib/socialtrading/account", () => ({ loadAccount: async () => db.account }));
vi.mock("@/lib/socialtrading/providers/brokerage", () => ({ brokerage: {}, BrokerageNotConnected: class extends Error {} }));
vi.mock("@/lib/socialtrading/providers/market-data", () => ({ marketData: {} }));
vi.mock("@/lib/socialtrading/providers/crypto-data", () => ({ cryptoData: {} }));
import { POST } from "./route";
const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/trade/state", { method: "POST", body: JSON.stringify({ revision: db.state?.revision ?? 0, ...body }) }));
const interest = (symbol: string, kind: "stock" | "crypto" | "custom" = "stock") => ({ id: symbol, symbol, name: symbol, kind });

beforeEach(() => {
  db.state = { ...structuredClone(PREVIEW_STATE), profile: { ...structuredClone(PREVIEW_STATE.profile), interests: ["NVDA", "VRT", "CRWV", "CEG", "OKLO"].map(s => interest(s)) } };
  db.account = { ...PREVIEW_ACCOUNT, usage: { agents: 2, enabledAgents: 1, chats: 20 } };
  db.saved = [];
});

it("refuses a sixth follow from an asset card with the remedy, but still records the learning signal for a removal", async () => {
  const blocked = await post({ action: "signal", signal: "watched", target: "SMR", kind: "stock", symbol: "SMR", name: "NuScale" });
  expect(blocked.status).toBe(422);
  expect(await blocked.json()).toMatchObject({ code: "limit", limit: "follows", error: expect.stringMatching(/Following allows up to 5 followed assets\. Unfollow an asset/) });
  expect(db.saved).toEqual([]);
  const removed = await post({ action: "signal", signal: "removed", target: "OKLO" });
  expect(removed.status).toBe(200);
  const { state, account } = await removed.json();
  expect(state.profile.interests.map((i: { id: string }) => i.id)).toEqual(["NVDA", "VRT", "CRWV", "CEG"]);
  expect(account.planId).toBe("free");
});

it("lets a full profile be saved unchanged but not grown, section by section", async () => {
  const profile = db.state!.profile;
  const same = await post({ action: "profile", profile, dislikes: db.state!.dislikes, preferences: db.state!.preferences });
  expect(same.status).toBe(200);
  const grown = await post({ action: "profile", profile: { ...profile, interests: [...profile.interests, interest("idea", "custom")] }, dislikes: db.state!.dislikes, preferences: db.state!.preferences });
  expect(grown.status).toBe(422);
  expect(await grown.json()).toMatchObject({ limit: "preferenceItems", error: expect.stringContaining("Paying attention to") });
  const prefs = await post({ action: "profile", profile, dislikes: db.state!.dislikes, preferences: ["1", "2", "3", "4", "5", "6"] });
  expect(await prefs.json()).toMatchObject({ limit: "preferenceItems", error: expect.stringContaining("Things you care about") });
  const thesis = await post({ action: "agent", config: { ...defaultAgent(), name: "Agent" }, thesis: "x".repeat(1001) });
  expect(thesis.status).toBe(422);
  expect(await thesis.json()).toMatchObject({ limit: "thesisChars" });
});

it("caps chats across agents and always leaves an agent one chat to talk in", async () => {
  const full = await post({ action: "chat", op: "create" });
  expect(full.status).toBe(422);
  expect(await full.json()).toMatchObject({ code: "limit", limit: "chats", error: expect.stringMatching(/up to 20 chats\. Delete an old chat/) });
  db.account = { ...PREVIEW_ACCOUNT, usage: { agents: 2, enabledAgents: 1, chats: 19 } };
  const created = await post({ action: "chat", op: "create" });
  expect(created.status).toBe(200);
  const body = await created.json();
  expect(body.state.chats).toHaveLength(2);
  expect(body.chatId).toBe(body.state.chats[1].id);
  const deleted = await post({ action: "chat", op: "delete", chatId: body.chatId });
  expect((await deleted.json()).state.chats).toHaveLength(1);
  const last = await post({ action: "chat", op: "delete", chatId: "default" });
  const after = (await last.json()).state;
  expect(after.chats).toHaveLength(1);
  expect(after.chats[0].id).not.toBe("default");
  expect(after.chats[0].messages).toEqual([]);
  expect((await post({ action: "chat", op: "delete", chatId: "../x" })).status).toBe(400);
});
