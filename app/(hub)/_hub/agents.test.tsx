// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import { HubProvider, useHub, type HubContextValue } from "./hub-provider";
import type { HubState } from "@/lib/socialtrading/types";
import { newChat } from "@/lib/socialtrading/chats";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ getAccessToken: async () => "token" }) }));
it("clears drafts on switching and ignores a late learning response from the old agent", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let hub!: HubContextValue;
  function Probe() { hub = useHub(); return <p>{hub.state.agent?.name}</p>; }
  const a = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("a"), name: "Agent A" } };
  const b = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("b"), name: "Agent B" }, chats: [newChat("2026-09-15T00:00:00.000Z", "b-chat")] };
  let finish!: (value: { state: HubState }) => void;
  const post = vi.fn(() => new Promise<{ state: HubState }>(resolve => { finish = resolve; }));
  const load = vi.fn(async () => ({ state: b }));
  const element = document.createElement("div"), root = createRoot(element);
  try {
    await act(async () => root.render(<HubProvider userId="user" initial={a} api={{ load, post }}><Probe /></HubProvider>));
    await act(async () => { hub.setDraft("Agent A private draft"); hub.signal("opened", "NVDA"); });
    await act(async () => { await hub.switchAgent("b"); });
    expect(load).toHaveBeenCalledWith(expect.any(Function), "b");
    expect(hub.draft).toBe("");
    expect(hub.messages).toEqual([]);
    expect(hub.state.agent?.id).toBe("b");
    await act(async () => finish({ state: { ...a, revision: 100 } }));
    expect(hub.state.agent?.id).toBe("b");
    expect(post).toHaveBeenCalledWith(expect.any(Function), a.revision, expect.any(Object), "a");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
