import { beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "./config";
const { rows, client } = vi.hoisted(() => {
  const rows = new Map<string, { state: unknown; revision: number }>();
  const client = {
    from: vi.fn(() => {
      const filters: Record<string, string> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        maybeSingle: async () => ({ data: structuredClone(rows.get(`${filters.user_id}/${filters.agent_id}`) ?? null), error: null }),
      };
      return query;
    }),
    rpc: vi.fn(async (_name: string, args: { p_user_id: string; p_agent_id: string; p_revision: number; p_state: unknown }) => {
      const key = `${args.p_user_id}/${args.p_agent_id}`, row = rows.get(key);
      if (!row || row.revision !== args.p_revision) return { data: false, error: null };
      rows.set(key, { state: structuredClone(args.p_state), revision: row.revision + 1 });
      return { data: true, error: null };
    }),
  };
  return { rows, client };
});
vi.mock("@/lib/supabase", () => ({ serviceClient: () => client }));
import { loadState, saveState, requestedAgent } from "../server";
beforeEach(() => { rows.clear(); vi.clearAllMocks(); });
it("loads legacy state as default without dropping history", async () => {
  rows.set("user/default", { state: PREVIEW_STATE, revision: 7 });
  const state = await loadState("user");
  expect(state?.agent?.id).toBe("default");
  expect(state?.messages).toEqual(PREVIEW_STATE.messages);
  expect(state?.revision).toBe(7);
});
it("isolates owners, agents, and concurrent revisions", async () => {
  for (const id of ["a", "b"]) rows.set(`user/${id}`, { state: { ...PREVIEW_STATE, agent: defaultAgent(id) }, revision: 0 });
  expect(await loadState("other", "a")).toBeNull();
  const a = (await loadState("user", "a"))!, stale = (await loadState("user", "a"))!;
  a.profile.thesis = "Agent A only";
  await saveState("user", a);
  expect((await loadState("user", "b"))?.profile.thesis).toBe(PREVIEW_STATE.profile.thesis);
  await expect(saveState("user", stale)).rejects.toMatchObject({ status: 409 });
  expect(client.rpc).toHaveBeenCalledWith("socialtrading_agent_save", expect.objectContaining({ p_agent_id: "a", p_user_id: "user" }));
});
it("rejects malformed agent identifiers", () => {
  expect(requestedAgent(undefined)).toBe("default");
  expect(() => requestedAgent("../other")).toThrow();
});
