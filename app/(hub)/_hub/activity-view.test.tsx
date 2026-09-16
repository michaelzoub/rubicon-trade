// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_ACCOUNT, PREVIEW_STATE } from "../../preview/fixture";

vi.mock("@privy-io/react-auth", () => ({
  useSign7702Authorization: () => ({ signAuthorization: vi.fn(async () => ({ r: "0x1", s: "0x2", yParity: 0, address: "0x0", chainId: 8453, nonce: 0 })) }),
  usePrivy: () => ({ getAccessToken: async () => "token", ready: true, authenticated: true, user: { id: "preview-user", linkedAccounts: [] } }),
  useWallets: () => ({ ready: true, wallets: [] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/activity" }));
import { HubProvider } from "./hub-provider";
import { ActivityView, needsYou } from "./activity-view";
import { GlossProvider, GLOSS_ID } from "./gloss";
import { buildGraph, summarise } from "@/lib/socialtrading/memory-graph";

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async () => act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT}><GlossProvider><ActivityView /></GlossProvider></HubProvider>));

it("draws the worldview as beliefs rather than as a report", async () => {
  await render();
  const frames = buildGraph(PREVIEW_STATE);
  const latest = frames[frames.length - 1];

  // Nothing here is an activity page any more.
  expect(container.querySelector(".hub-pulse-bead")).toBeNull();
  expect(container.querySelector(".hub-lens-item")).toBeNull();
  expect(container.querySelector(".hub-day")).toBeNull();
  expect(container.textContent).not.toContain("Your world, lately");

  const beliefs = Array.from(container.querySelectorAll<HTMLElement>(".mem-belief"));
  expect(beliefs).toHaveLength(latest.nodes.length);
  // Conviction is the size of the body, so strength is read rather than printed.
  expect(beliefs[0].style.getPropertyValue("--strength")).toBe(String(latest.nodes[0].strength));
  expect(beliefs[0].getAttribute("aria-describedby")).toBe(GLOSS_ID);
  expect(container.querySelectorAll(".mem-edges line").length).toBeGreaterThan(0);
});

it("moves through time from the keyboard as well as by dragging", async () => {
  await render();
  const frames = buildGraph(PREVIEW_STATE);
  if (frames.length < 2) return;
  const field = container.querySelector<HTMLElement>(".mem-field")!;
  expect(container.querySelectorAll(".mem-tick")).toHaveLength(frames.length);
  expect(container.querySelector('.mem-tick[aria-current="true"]')).toBe(container.querySelectorAll(".mem-tick")[frames.length - 1]);

  await act(async () => field.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(container.querySelector('.mem-tick[aria-current="true"]')).toBe(container.querySelectorAll(".mem-tick")[frames.length - 2]);
  expect(container.querySelector(".mem-now")?.textContent).toContain(summarise(frames[frames.length - 2]));
});

it("keeps the exact sequence reachable underneath the field", async () => {
  await render();
  const record = container.querySelector(".mem-record")!;
  expect(record.querySelector("summary")?.textContent).toBe("Everything, in order");
  expect(record.querySelectorAll("ol > li")).toHaveLength(PREVIEW_STATE.events.length);
});

it("says what each belief did, for anyone who cannot see it move", async () => {
  await render();
  const labels = Array.from(container.querySelectorAll(".mem-belief")).map(b => b.getAttribute("aria-label") ?? "");
  expect(labels.every(l => /per cent conviction/.test(l))).toBe(true);
  expect(container.querySelector(".mem-field")?.getAttribute("aria-label")).toContain("arrow keys");
});

it("knows which trades are waiting on a signature or approval", () => {
  const [stock, swap] = PREVIEW_STATE.trades;
  expect(needsYou(stock)).toBe(true);
  expect(needsYou({ ...stock, status: "confirmed" })).toBe(false);
  expect(needsYou({ ...swap, status: "reserved" })).toBe(true);
  expect(needsYou({ ...swap, status: "reserved", crypto: { ...swap.crypto!, phase: "issued" } })).toBe(false);
  expect(needsYou(undefined)).toBe(false);
});
