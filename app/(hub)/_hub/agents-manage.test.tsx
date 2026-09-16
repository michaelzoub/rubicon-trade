// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import { HubProvider, useHub, type HubContextValue } from "./hub-provider";
import { HubRequestError } from "./client";
vi.mock("@privy-io/react-auth", () => ({ useSign7702Authorization: () => ({ signAuthorization: vi.fn() }), usePrivy: () => ({ getAccessToken: async () => "token" }) }));

it("toggles scheduled runs across agents, surfaces the cap, and lands on a remaining agent after deletion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let hub!: HubContextValue;
  function Probe() { hub = useHub(); return <p>{hub.state.agent?.name}</p>; }
  const a = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("a"), name: "Agent A" } };
  const b = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("b"), name: "Agent B", enabled: true } };
  const c = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("c"), name: "Agent C", enabled: true } };
  const list = new Map([["a", a], ["b", b], ["c", c]]);
  const agents = () => ({ agents: [...list.values()].map(s => s.agent!) });
  const setAgentEnabled = vi.fn(async (_t: unknown, id: string, enabled: boolean) => {
    if (enabled && [...list.values()].filter(s => s.agent!.enabled && s.agent!.id !== id).length >= 2) throw new HubRequestError(409, "Only 2 agents can run at once. Pause another agent first.");
    list.get(id)!.agent!.enabled = enabled; return agents();
  });
  const deleteAgent = vi.fn(async (_t: unknown, id: string) => { list.delete(id); return agents(); });
  const load = vi.fn(async (_t: unknown, id = "default") => ({ state: list.get(id) ?? null }));
  const element = document.createElement("div"), root = createRoot(element);
  try {
    await act(async () => root.render(<HubProvider userId="user" initial={a} api={{ load, setAgentEnabled, deleteAgent, agents: async () => agents() }}><Probe /></HubProvider>));
    await act(async () => { await hub.refreshAgents(); });
    expect(hub.agents.filter(x => x.enabled).map(x => x.id)).toEqual(["b", "c"]);
    // The cap: the server says no, the provider shows the message and leaves state alone.
    await act(async () => { expect(await hub.setAgentEnabled("a", true)).toBe(false); });
    expect(hub.error).toMatch(/Only 2 agents/);
    expect(hub.state.agent?.enabled).toBe(false);
    // Pausing another agent from the rail does not switch selection but frees a slot.
    await act(async () => { expect(await hub.setAgentEnabled("c", false)).toBe(true); });
    expect(hub.state.agent?.id).toBe("a");
    await act(async () => { expect(await hub.setAgentEnabled("a", true)).toBe(true); });
    expect(hub.state.agent?.enabled).toBe(true);
    expect(hub.agents.find(x => x.id === "a")?.enabled).toBe(true);
    // Deleting the selected agent moves the hub onto the first remaining one.
    await act(async () => { expect(await hub.deleteAgent("a")).toBe(true); });
    expect(deleteAgent).toHaveBeenCalledWith(expect.any(Function), "a");
    expect(hub.state.agent?.id).toBe("b");
    expect(hub.agents.map(x => x.id)).toEqual(["b", "c"]);
    expect(load).toHaveBeenLastCalledWith(expect.any(Function), "b");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
