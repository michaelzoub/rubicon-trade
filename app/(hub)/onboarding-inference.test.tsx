// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { CardFetcher } from "./onboarding-client";
import { FAMILIARITY_CONCEPTS } from "../../lib/socialtrading/familiarity";
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

async function render(nextCard: CardFetcher) {
  await act(async () => root.render(<InferenceOnboarding userId="alice" persist={false} variant="inference" forced={false} nextCard={nextCard} />));
}
/** Through the two shared foundations and the seed view. */
async function foundations() {
  await click("I know what I believe"); await click("Continue");
  for (const concept of FAMILIARITY_CONCEPTS) await click(concept.label);
  await click("Continue");
  await click("I see it");
}

const card = (id: string, over: Record<string, unknown> = {}) => ({ done: false as const, card: { id, kind: "binary" as const, title: `Generated ${id}`, lead: "Because of what you said.", category: "Energy", ...over } });

it("asks the model for each next card and carries the answers into one thesis", async () => {
  const complete = vi.fn();
  const nextCard = vi.fn()
    .mockResolvedValueOnce(card("g1"))
    .mockResolvedValue({ done: true });
  await act(async () => root.render(<InferenceOnboarding userId="alice" persist={false} variant="inference" forced={false} nextCard={nextCard} onComplete={complete} />));
  await foundations();
  expect(title()).toBe("Generated g1");

  // What the model was told: the seed answer, not just a question count.
  const sent = nextCard.mock.calls[0][0];
  expect(sent.knowledge).toBe(3);
  expect(sent.confidence).toBe(3);
  expect(sent.priors[0]).toMatchObject({ direction: "yes", category: "Technology" });

  await click("I see it");
  expect(title()).toBe("Your outlook. Your rules.");
  await act(async () => (container.querySelector('input[value="notify"]') as HTMLInputElement).click());
  await click("Meet my agent");

  const profile = complete.mock.calls[0][0];
  expect(profile.thesis).toContain("Generated g1");
  expect(profile.thesis).toContain("Robotics changes the physical economy");
  expect(profile.completedAt).toBeTruthy();
});

it("falls back to a standard question when the model fails, and says so", async () => {
  const nextCard = vi.fn().mockRejectedValue(new Error("upstream 402"));
  await render(nextCard);
  await foundations();
  expect(container.textContent).toContain("Your agent couldn’t write this one");
  // The run still moves forward rather than stranding anyone.
  expect(title().length).toBeGreaterThan(0);
  expect(title()).not.toBe("Your agent is thinking…");
});

it("records a fallback run as fallback so it is never counted as inference", async () => {
  await render(vi.fn().mockRejectedValue(new Error("upstream")));
  await foundations();
  const run = loadRuns()[0];
  expect(run.variant).toBe("inference");
  expect(run.source).toBe("fallback");
});

it("logs only the cards that were shown, never the gap while one is in flight", async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise(resolve => { release = resolve; });
  const nextCard = vi.fn().mockImplementation(() => pending);
  await render(nextCard as unknown as CardFetcher);
  await foundations();
  // Still waiting on the first generated card.
  expect(loadRuns()[0].cards.map(c => c.id)).toEqual(["clarity", "knowledge", "seed-0"]);
  await act(async () => { release(card("g1")); await pending; });
  expect(loadRuns()[0].cards.map(c => c.id)).toEqual(["clarity", "knowledge", "seed-0", "g1"]);
});

it("stops asking for cards once the budget is spent", async () => {
  const nextCard = vi.fn()
    .mockResolvedValueOnce(card("g1")).mockResolvedValueOnce(card("g2"))
    .mockResolvedValueOnce(card("g3")).mockResolvedValueOnce(card("g4"))
    .mockResolvedValue({ done: true });
  await render(nextCard);
  await foundations();
  for (const id of ["g1", "g2", "g3", "g4"]) { expect(title()).toBe(`Generated ${id}`); await click("I see it"); }
  expect(title()).toBe("Your outlook. Your rules.");
  expect(nextCard.mock.calls.length).toBeLessThanOrEqual(5);
});
