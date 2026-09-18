// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { DeckFetcher } from "./onboarding-client";
import { FAMILIARITY_CONCEPTS } from "../../lib/socialtrading/familiarity";
import { CATEGORIES, DECK_TITLE } from "../../lib/socialtrading/onboarding";
import { loadRuns } from "../../lib/socialtrading/onboarding-metrics";

vi.mock("@privy-io/react-auth", () => ({ getAccessToken: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
import { InferenceOnboarding } from "./onboarding-inference";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)", media: query,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
const title = () => container.querySelector(".onb-card-title")?.textContent ?? "";
const statement = () => container.querySelector(".onb-card-swipe[data-depth='0'] h2")?.textContent ?? "";

async function render(fetchDeck: DeckFetcher) {
  await act(async () => root.render(<InferenceOnboarding userId="alice" persist={false} variant="inference" forced={false} fetchDeck={fetchDeck} />));
}
async function foundations() {
  await click("I know what I believe"); await click("Continue");
  for (const concept of FAMILIARITY_CONCEPTS) await click(concept.label);
  await click("Continue");
}

const pack = CATEGORIES.map((category, i) => ({
  id: `g${i}`, kind: "binary" as const, title: `Generated ${category}`, lead: "Take a side.", category,
}));

it("asks the model for the seven-domain pack once and carries a swipe into the thesis", async () => {
  const complete = vi.fn();
  const fetchDeck = vi.fn().mockResolvedValue(pack);
  await act(async () => root.render(<InferenceOnboarding userId="alice" persist={false} variant="inference" forced={false} fetchDeck={fetchDeck} onComplete={complete} />));
  await foundations();
  expect(title()).toBe(DECK_TITLE);
  expect(statement()).toBe("Generated Technology");
  expect(container.querySelector(".onb-agent-peek")).toBeNull();
  expect(container.querySelector(".onb-chip")).toBeNull();
  expect(fetchDeck).toHaveBeenCalledTimes(1);
  expect(fetchDeck.mock.calls[0][0]).toMatchObject({ knowledge: 3, confidence: 3 });

  for (const category of CATEGORIES) {
    expect(title()).toBe(DECK_TITLE);
    expect(statement()).toBe(`Generated ${category}`);
    await click("I see it");
  }
  expect(title()).toBe("Your outlook. Your rules.");
  expect(fetchDeck).toHaveBeenCalledTimes(1);
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");

  const profile = complete.mock.calls[0][0];
  expect(profile.thesis).toContain("Generated Technology");
  expect(profile.completedAt).toBeTruthy();
});

it("does not let a swipe change the next domain", async () => {
  const fetchDeck = vi.fn().mockResolvedValue(pack);
  await render(fetchDeck);
  await foundations();
  expect(title()).toBe(DECK_TITLE);
  expect(statement()).toBe("Generated Technology");
  await click("I don’t see it");
  expect(statement()).toBe("Generated Energy");
  expect(fetchDeck).toHaveBeenCalledTimes(1);
});

it("falls back to a standard question when the model fails, without saying so", async () => {
  const fetchDeck = vi.fn().mockRejectedValue(new Error("upstream 402"));
  await render(fetchDeck);
  await foundations();
  expect(container.textContent).not.toContain("Your agent couldn’t write this one");
  expect(container.textContent).not.toContain("Your agent is thinking");
  expect(title()).not.toBe("Your agent is thinking…");
});

it("records a fallback run as fallback so it is never counted as inference", async () => {
  await render(vi.fn().mockRejectedValue(new Error("upstream")));
  await foundations();
  const run = loadRuns()[0];
  expect(run.variant).toBe("inference");
  expect(run.source).toBe("fallback");
});

it("logs only the cards that were shown, never the gap while the pack is in flight", async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise(resolve => { release = resolve; });
  const fetchDeck = vi.fn().mockImplementation(() => pending);
  await render(fetchDeck as unknown as DeckFetcher);
  await foundations();
  expect(loadRuns()[0].cards.map(c => c.id)).toEqual(["clarity", "knowledge"]);
  expect(container.textContent).not.toContain("Your agent is thinking");
  expect(container.textContent).not.toContain("Writing your next question");
  await act(async () => { release(pack); await pending; });
  expect(loadRuns()[0].cards.map(c => c.id)).toEqual(["clarity", "knowledge", "g0"]);
});
