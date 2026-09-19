// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InferredSwipeDeck } from "./onboarding-deck";
import { CATEGORIES } from "../../lib/socialtrading/onboarding";

vi.mock("@privy-io/react-auth", () => ({ getAccessToken: vi.fn(async () => null) }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)", media: query,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const pack = CATEGORIES.map((category, i) => ({
  id: `g${i}`, kind: "binary" as const, title: category === "Energy" ? "Power will bottleneck AI first." : `Generated ${category}`, lead: "Take a side.", category,
}));

it("keeps the tree’s category and uses inferred wording from the knowledge pack", async () => {
  const fetchDeck = vi.fn().mockResolvedValue(pack);
  const onVote = vi.fn();
  await act(async () => root.render(<InferredSwipeDeck
    upcoming={{ id: "2-1", category: "Energy", text: "Electricity demand grows faster than power systems can adapt." }}
    knowledge={2} confidence={3} fetchDeck={fetchDeck} onVote={onVote}
  />));
  expect(fetchDeck).toHaveBeenCalledTimes(1);
  expect(fetchDeck.mock.calls[0][0]).toMatchObject({ knowledge: 2, confidence: 3 });
  expect(container.textContent).toContain("Power will bottleneck AI first.");
  expect(container.textContent).toContain("Energy");
  expect(container.textContent).not.toContain("Electricity demand grows");
  expect(container.querySelector(".onb-chip")).toBeNull();
  expect(container.querySelector(".onb-deck")?.getAttribute("data-sector")).toBe("energy");
  expect(container.querySelector('.onb-vote[data-dir="no"]')).toBeTruthy();
  expect(container.querySelector('.onb-vote[data-dir="yes"]')).toBeTruthy();
  expect(container.querySelector('.onb-vote[data-dir="unsure"]')).toBeTruthy();
  expect(container.textContent).not.toContain("Swipe or tap to take a side");
  const yes = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes("Likely →"));
  await act(async () => yes!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onVote).toHaveBeenCalledWith("yes", expect.objectContaining({ id: "2-1", category: "Energy", text: "Power will bottleneck AI first." }));
});

it("falls back to the canned card when inference misses", async () => {
  const fetchDeck = vi.fn().mockRejectedValue(new Error("upstream"));
  await act(async () => root.render(<InferredSwipeDeck
    upcoming={{ id: "0-0", category: "Technology", text: "By 2035, robots will eliminate more physical jobs than they create." }}
    knowledge={0} confidence={0} fetchDeck={fetchDeck} onVote={() => {}}
  />));
  expect(container.textContent).toContain("Robots will eliminate more physical jobs than they create.");
  expect(container.textContent).toContain("By 2035");
  expect(container.textContent).not.toContain("Your agent couldn’t write this one");
  expect(container.textContent).not.toContain("Writing your next question");
});

it("deals the next card without announcing that it is being written", async () => {
  let release: (value: unknown) => void = () => {};
  const pending = new Promise(resolve => { release = resolve; });
  await act(async () => root.render(<InferredSwipeDeck
    upcoming={{ id: "0-0", category: "Technology", text: "By 2035, robots will eliminate more physical jobs than they create." }}
    knowledge={0} confidence={0} fetchDeck={() => pending as never} onVote={() => {}}
  />));
  expect(container.textContent).not.toContain("Writing your next question");
  expect(container.textContent).not.toContain("Your agent is thinking");
  expect(container.querySelector(".onb-card-swipe.is-face-down")).toBeTruthy();
  await act(async () => { release(pack); });
});
