import { beforeEach, expect, it, vi } from "vitest";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
/** Mimics the Postgres trigger: at most two enabled agents per user, atomically. */
const { rows, rpc, deleted, authenticate } = vi.hoisted(() => {
  const rows = new Map<string, { agent_id: string; enabled: boolean; agent: unknown }>();
  const deleted: string[] = [];
  const rpc = vi.fn(async (name: string, args: { p_user_id: string; p_agent_id: string; p_enabled: boolean }) => {
    if (name !== "socialtrading_agent_set_enabled") return { data: null, error: { message: "unknown rpc" } };
    const row = rows.get(args.p_agent_id);
    if (!row) return { data: null, error: null };
    if (args.p_enabled && [...rows.values()].filter(r => r.enabled && r.agent_id !== args.p_agent_id).length >= 2) return { data: false, error: null };
    row.enabled = args.p_enabled;
    return { data: true, error: null };
  });
  return { rows, rpc, deleted, authenticate: vi.fn(async () => "owner") };
});
vi.mock("@/lib/socialtrading/server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/socialtrading/server")>(), authenticate }));
vi.mock("@/lib/socialtrading/account", async () => ({ loadAccount: async () => (await import("@/app/preview/fixture")).PREVIEW_ACCOUNT }));
vi.mock("@/lib/supabase", () => ({ serviceClient: () => ({
  rpc,
  from: () => ({
    select: () => ({ eq: () => ({ order: async () => ({ data: [...rows.values()].map(r => ({ agent_id: r.agent_id, enabled: r.enabled, agent: r.agent })), error: null }) }) }),
    delete: () => ({ eq: () => ({ eq: async (_k: string, id: string) => { deleted.push(id); rows.delete(id); return { error: null }; } }) }),
  }),
}) }));
import { DELETE, PATCH } from "./route";
const patch = (body: unknown) => PATCH(new Request("http://localhost/api/trade/agents", { method: "PATCH", body: JSON.stringify(body) }));
const remove = (agentId: string) => DELETE(new Request(`http://localhost/api/trade/agents?agentId=${agentId}`, { method: "DELETE" }));
const ids = ["default", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
beforeEach(() => { rows.clear(); deleted.length = 0; vi.clearAllMocks(); for (const id of ids) rows.set(id, { agent_id: id, enabled: false, agent: { ...defaultAgent(id), name: id.slice(0, 4) } }); });

it("enables up to two agents and reports the cap as a plan limit the UI can explain", async () => {
  expect((await patch({ agentId: ids[0], enabled: true })).status).toBe(200);
  const second = await patch({ agentId: ids[1], enabled: true });
  expect(second.status).toBe(200);
  expect((await second.json()).agents.filter((a: { enabled: boolean }) => a.enabled)).toHaveLength(2);
  const third = await patch({ agentId: ids[2], enabled: true });
  expect(third.status).toBe(422);
  expect(await third.json()).toMatchObject({ code: "limit", limit: "enabledAgents", error: expect.stringMatching(/Only 2 agents/) });
  expect(rows.get(ids[2])?.enabled).toBe(false);
  expect((await patch({ agentId: ids[0], enabled: false })).status).toBe(200);
  expect((await patch({ agentId: ids[2], enabled: true })).status).toBe(200);
});
it("rejects malformed toggles and unknown agents", async () => {
  expect((await patch({ agentId: ids[0], enabled: "yes" })).status).toBe(400);
  expect((await patch({ agentId: "../x", enabled: true })).status).toBe(400);
  expect((await patch({ agentId: "33333333-3333-4333-8333-333333333333", enabled: true })).status).toBe(404);
});
it("deletes an agent but never the last one", async () => {
  expect((await remove(ids[1])).status).toBe(200);
  expect(deleted).toEqual([ids[1]]);
  expect((await remove(ids[2])).status).toBe(200);
  const last = await remove(ids[0]);
  expect(last.status).toBe(400);
  expect((await last.json()).error).toMatch(/at least one agent/);
  expect(rows.has(ids[0])).toBe(true);
  expect((await remove("44444444-4444-4444-8444-444444444444")).status).toBe(404);
});
