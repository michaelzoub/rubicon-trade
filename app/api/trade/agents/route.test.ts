import { newProfile } from "@/lib/socialtrading/profile";
import { beforeEach, expect, it, vi } from "vitest";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import { PREVIEW_ACCOUNT } from "@/app/preview/fixture";
const { insert, authenticate, account } = vi.hoisted(() => ({ insert: vi.fn(async (_row: unknown) => ({ error: null })), authenticate: vi.fn(async () => "owner"), account: { usage: { agents: 1, enabledAgents: 0, chats: 1 } } }));
vi.mock("@/lib/socialtrading/server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/socialtrading/server")>(), authenticate }));
vi.mock("@/lib/supabase", () => ({ serviceClient: () => ({ from: () => ({ insert }) }) }));
vi.mock("@/lib/socialtrading/account", () => ({ loadAccount: async () => ({ ...PREVIEW_ACCOUNT, usage: account.usage }) }));
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/trade/agents", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); account.usage = { agents: 1, enabledAgents: 0, chats: 1 }; });
it("creates fresh notify-only state owned by the authenticated user", async () => {
  const response = await POST(request({ ...defaultAgent("forged"), userId: "attacker", name: "Energy", thesis: "Energy infrastructure", permission: "automatic", messages: ["old"], brokerage: { connected: true } }));
  expect(response.status).toBe(201);
  const { state } = await response.json();
  expect(state.agent.id).not.toBe("forged");
  expect(state.profile).toMatchObject({ userId: "owner", permission: "notify", thesis: "Energy infrastructure", interests: [] });
  expect(state.chats).toHaveLength(1);
  expect(state.chats[0].messages).toEqual([]);
  expect(state.trades).toEqual([]);
  expect(state.brokerage).toBeUndefined();
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner", agent_id: state.agent.id }));
});
it("rejects a missing or empty thesis before inserting", async () => {
  for (const body of [null, { ...defaultAgent(), thesis: " " }, { ...defaultAgent(), thesis: 12 }]) {
    expect((await POST(request(body))).status).toBe(400);
  }
  expect(insert).not.toHaveBeenCalled();
});
it("refuses a fourth agent, an over-long thesis, and translates the Postgres cap the same way", async () => {
  account.usage = { agents: 3, enabledAgents: 0, chats: 3 };
  const full = await POST(request({ ...defaultAgent(), name: "Fourth", thesis: "Energy" }));
  expect(full.status).toBe(422);
  expect(await full.json()).toMatchObject({ code: "limit", limit: "agents", error: expect.stringMatching(/up to 3 agents\. Delete an agent/) });
  account.usage = { agents: 1, enabledAgents: 0, chats: 1 };
  const long = await POST(request({ ...defaultAgent(), name: "Wordy", thesis: "x".repeat(1001) }));
  expect(long.status).toBe(422);
  expect(await long.json()).toMatchObject({ limit: "thesisChars" });
  expect(insert).not.toHaveBeenCalled();
  insert.mockResolvedValueOnce({ error: { message: "AGENT_COUNT_LIMIT", hint: "This plan allows up to 3 agents." } });
  const raced = await POST(request({ ...defaultAgent(), name: "Raced", thesis: "Energy" }));
  expect(raced.status).toBe(422);
  expect(await raced.json()).toMatchObject({ code: "limit", limit: "agents" });
});

it("preserves the completed onboarding choices and keeps the agent paused", async () => {
  const fresh = newProfile("owner");
  const profile = { ...fresh, thesis: "Healthcare and AI", investorAnswers: { ...fresh.investorAnswers, knowledge: 4, futureVision: "Healthcare and AI" }, themes: ["ai", "healthcare"], interests: [{ id: "custom:longevity", name: "Longevity", kind: "custom" }], permission: "automatic", permissionConfigured: true, limits: { perTrade: "10", daily: "20", weekly: "100" }, step: 6, completedAt: new Date().toISOString() };
  const response = await POST(request({ ...defaultAgent(), name: "Longer lives", thesis: profile.thesis, profile }));
  expect(response.status).toBe(201);
  const { state } = await response.json();
  expect(state.profile).toMatchObject({ ...profile, completedAt: expect.any(String), updatedAt: expect.any(String) });
  expect(state.agent.enabled).toBe(false);
  expect(state.inferred).toEqual([]);
  const invalid = await POST(request({ ...defaultAgent(), thesis: profile.thesis, profile: { ...profile, limits: { perTrade: "", daily: "", weekly: "" } } }));
  expect(invalid.status).toBe(400);
});
