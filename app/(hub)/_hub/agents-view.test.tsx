// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import type { RunRecord } from "@/lib/socialtrading/runtime/types";
import { HubProvider } from "./hub-provider";
import { AgentsView } from "./agents-view";
// Privy hands back one stable token getter; a fresh function per render would make every provider callback churn.
const privy = vi.hoisted(() => ({ getAccessToken: async () => "token" }));
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => privy }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/agents" }));

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const click = (node: Element | null | undefined) => act(async () => { (node as HTMLElement).click(); });
const text = () => document.body.textContent ?? "";

it("shows one living card per agent, reveals an agent in a dialog, and wakes a resting one", async () => {
  const a = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("a"), name: "Michael’s AI & Energy agent", description: "AI × Energy through your point of view", enabled: true } };
  const b = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("b"), name: "Chain Scout", description: "Crypto through your point of view" }, profile: { ...structuredClone(PREVIEW_STATE.profile), themes: ["crypto" as const], interests: [{ id: "bitcoin", symbol: "BTC", name: "Bitcoin", kind: "crypto" as const }] } };
  const list = new Map([["a", a], ["b", b]]);
  const agents = () => ({ agents: [...list.values()].map(s => ({ ...s.agent!, themes: s.profile.themes })), account: PREVIEW_ACCOUNT });
  const runs: Record<string, RunRecord[]> = { a: [{ id: "r1", trigger: "cron", slot: null, status: "succeeded", startedAt: new Date().toISOString(), finishedAt: null, summary: "Vertiv raised guidance; nothing else moved.", decision: null, error: null, notified: false }], b: [] };
  runs.a.unshift({ ...runs.a[0], id: "quiet", summary: "" });
  runs.a.unshift({ ...runs.a[0], id: "failed", status: "failed", summary: "The run failed." });
  const setAgentEnabled = vi.fn(async (_t: unknown, id: string, enabled: boolean) => { list.get(id)!.agent!.enabled = enabled; return agents(); });
  const api = { agents: async () => agents(), load: async (_t: unknown, id = "default") => ({ state: list.get(id) ?? null }), runs: async (_t: unknown, id: string) => ({ runs: runs[id] ?? [] }), setAgentEnabled };

  await act(async () => root.render(<HubProvider userId="user" name="Michael" initial={a} initialAccount={PREVIEW_ACCOUNT} api={api}><AgentsView /></HubProvider>));
  await act(async () => { await Promise.resolve(); });

  const cards = container.querySelectorAll(".hub-agent-card:not(.is-new)");
  expect(cards).toHaveLength(2);
  expect(cards[0].textContent).toContain("Michael’s AI & Energy agent");
  expect(cards[0].textContent).toContain("Analyzing");
  expect(cards[1].classList.contains("is-resting")).toBe(true);
  expect(cards[1].textContent).toContain("Wake up");
  // No settings vocabulary or form controls anywhere on the page.
  expect(text()).not.toMatch(/running|paused|cron|schedule|notification|prompt|model|tools/i);
  expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);

  // Revealing an agent shows what it is paying attention to and what it noticed, without switching agents.
  await click(cards[0].querySelector(".hub-agent-card-open"));
  const dialog = document.querySelector("[role=dialog]");
  expect(dialog).not.toBeNull();
  expect(dialog!.textContent).toContain("Paying attention to");
  expect(dialog!.textContent).toContain("VRT");
  expect(dialog!.textContent).toContain("Vertiv raised guidance");
  expect(dialog!.querySelectorAll(".hub-reveal-noticed li")).toHaveLength(1);
  expect(dialog!.textContent).not.toContain("The run failed.");
  expect(dialog!.textContent).toContain("Let it rest");
  expect(dialog!.textContent).toContain("Say goodbye");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(document.querySelector("[role=dialog]")).toBeNull();

  // Waking a resting agent is one action on its card.
  const wake = [...cards[1].querySelectorAll("button")].find(b => b.textContent?.includes("Wake up"));
  await click(wake);
  expect(setAgentEnabled).toHaveBeenCalledWith(expect.any(Function), "b", true);
  await act(async () => { await Promise.resolve(); });
  expect(container.querySelectorAll(".hub-agent-card.is-resting")).toHaveLength(0);
});
