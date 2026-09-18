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
import { buildGraph, summarise, type GraphFrame } from "@/lib/socialtrading/memory-graph";
import { buildTree, treePlan } from "@/lib/socialtrading/belief-tree";
import type { JevAnswers } from "@/lib/socialtrading/jev-types";

/** An answer to every question one chapter would ask, shaped like Jev's. */
const answersFor = (frame: GraphFrame): JevAnswers => Object.fromEntries(
  Object.entries(treePlan(frame, PREVIEW_STATE.profile.themes).questions).map(([id, question]) =>
    question.type === "choice"
      ? [id, { type: "choice", choice: Object.keys(question.criteria)[0], probabilities: {}, confidence: .82 }]
      : [id, { type: "score", score: 3, legend: {}, probabilities: {}, confidence: .82 }]),
);

/** Stand in for the route, so the view is exercised against a chapter Jev
 * answered rather than against one it never reached. */
const withJev = (source: "jev" | "local" = "jev") => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
  const frames = buildGraph(PREVIEW_STATE);
  const asked = String(JSON.parse(String(init?.body ?? "{}")).frameId ?? "");
  const frame = frames.find(f => f.id === asked) ?? frames[frames.length - 1];
  const body = String(url).includes("/api/trade/beliefs")
    ? { frameId: frame.id, answers: source === "jev" ? answersFor(frame) : {}, source, model: "test" }
    : {};
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}));

/** Past the settle delay and the round trip the view makes after it. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 520)); });

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const render = async () => act(async () => root.render(<HubProvider userId="preview-user" name="Michael" initial={PREVIEW_STATE} initialAccount={PREVIEW_ACCOUNT}><GlossProvider><ActivityView /></GlossProvider></HubProvider>));

it("starts as a bare trunk and draws nothing until Jev has answered", async () => {
  withJev();
  await render();

  // The thesis is the measure, so it is there from the first paint. Everything
  // around it is a reading, and no reading exists yet.
  expect(container.querySelectorAll(".mem-trunk")).toHaveLength(1);
  expect(container.querySelectorAll(".mem-belief")).toHaveLength(0);
  expect(container.querySelector(".mem-empty")?.textContent).toContain("nothing is drawn until it answers");
  // Nothing claims to be a scale while there is nothing on it.
  expect(container.querySelector(".mem-key")).toBeNull();

  await settle();
  expect(container.querySelectorAll(".mem-belief").length).toBeGreaterThan(0);
  expect(container.querySelector(".mem-empty")).toBeNull();
});

it("leaves the trunk bare when Jev cannot be read, and offers another go", async () => {
  withJev("local");
  await render();
  await settle();

  expect(container.querySelectorAll(".mem-belief")).toHaveLength(0);
  const empty = container.querySelector(".mem-empty")!;
  expect(empty.textContent).toContain("could not be read");
  expect(empty.querySelector<HTMLButtonElement>(".mem-reread")?.textContent).toBe("Read it again");

  // Asking again goes back to reading rather than sitting on the failure.
  withJev();
  await act(async () => empty.querySelector<HTMLButtonElement>(".mem-reread")!.click());
  expect(container.querySelector(".mem-empty")?.textContent).toContain("nothing is drawn until it answers");
  await settle();
  expect(container.querySelectorAll(".mem-belief").length).toBeGreaterThan(0);
});

it("draws the worldview as a tree rooted in the thesis, not as a report", async () => {
  withJev();
  await render();
  await settle();
  const frames = buildGraph(PREVIEW_STATE);
  const latest = frames[frames.length - 1];
  const tree = buildTree(latest, treePlan(latest, PREVIEW_STATE.profile.themes), answersFor(latest));

  // Nothing here is an activity page any more.
  expect(container.querySelector(".hub-pulse-bead")).toBeNull();
  expect(container.querySelector(".hub-lens-item")).toBeNull();
  expect(container.querySelector(".hub-day")).toBeNull();
  expect(container.textContent).not.toContain("Your world, lately");

  // One trunk, always the thesis, always the centre.
  expect(container.querySelectorAll(".mem-trunk")).toHaveLength(1);

  const beliefs = Array.from(container.querySelectorAll<HTMLElement>(".mem-belief"));
  expect(beliefs).toHaveLength(tree.nodes.length - 1);
  expect(beliefs.some(b => b.dataset.tier === "pillar")).toBe(true);
  expect(beliefs.some(b => b.dataset.tier === "idea")).toBe(true);
  // Colour and size are the confidence, so it is read rather than printed.
  for (const belief of beliefs) {
    expect(belief.style.getPropertyValue("--conf")).toMatch(/^#[0-9a-f]{6}$/);
    expect(Number(belief.style.getPropertyValue("--strength"))).toBeGreaterThanOrEqual(0);
  }
  expect(beliefs[0].getAttribute("aria-describedby")).toBe(GLOSS_ID);
  expect(container.querySelectorAll(".mem-edges line").length).toBeGreaterThan(0);
  // Every number on the tree is the model's, so that is what the scale says.
  expect(container.querySelector(".mem-key")?.textContent).toContain("placed by how closely it lines up with your thesis");
  // The one place the reading is explained in words, on demand rather than as a caption.
  expect(container.querySelector(".mem-key-help")?.getAttribute("aria-label")).toBe("How to read this tree");
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
  withJev();
  await render();
  await settle();
  const labels = Array.from(container.querySelectorAll(".mem-belief")).map(b => b.getAttribute("aria-label") ?? "");
  expect(labels.length).toBeGreaterThan(0);
  // Colour is a reading, so the same reading is spelled out in words and a number.
  expect(labels.every(l => /(Foundational|Strongly aligned|Loosely aligned|Barely aligned|Pulls against it) with your thesis, \d+%\./.test(l))).toBe(true);
  // The thesis is the measure, so it reports no reading of its own.
  expect(container.querySelector(".mem-trunk")?.getAttribute("aria-label")).toContain("carries no score");
  expect(container.querySelector(".mem-trunk")?.getAttribute("aria-label")).not.toMatch(/\d+%/);
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
