// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ProbeFetcher, ProbeRequest } from "./onboarding-client";
import { FAMILIARITY_CONCEPTS } from "../../lib/socialtrading/familiarity";
import { newProfileModel, recordEvidence, type ProfileModel } from "../../lib/socialtrading/profile-model";
import type { Probe } from "../../lib/socialtrading/profile-probe";
import { loadRuns } from "../../lib/socialtrading/onboarding-metrics";

vi.mock("@privy-io/react-auth", () => ({ getAccessToken: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));
import { AdaptiveOnboarding } from "./onboarding-adaptive";

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

async function foundations() {
  await click("I know what I believe"); await click("Continue");
  for (const concept of FAMILIARITY_CONCEPTS) await click(concept.label);
  await click("Continue");
}

const choice = (id: string, text: string): Probe =>
  ({ id, kind: "choice", title: text, lead: "Take a side.", topics: ["robotics"], category: "Technology" });

async function render(fetchProbe: ProbeFetcher, onComplete?: () => void) {
  await act(async () => root.render(<AdaptiveOnboarding userId="alice" persist={false} variant="adaptive" forced={false} fetchProbe={fetchProbe} onComplete={onComplete} />));
}

it("asks the probe the sequencer returned, and sends the answer back as evidence", async () => {
  const seen: ProbeRequest[] = [];
  let model = newProfileModel();
  const fetchProbe: ProbeFetcher = vi.fn(async input => {
    seen.push(input);
    // The route echoes the model back with Jev's reading attached.
    model = { ...input.model, source: "jev", beliefs: [{ topic: "robotics", p: 0.7, certainty: 0.4 }] };
    return { model, probe: choice("probe:robotics", `Question ${seen.length}`) };
  });
  await render(fetchProbe);
  await foundations();

  expect(statement()).toBe("Question 1");
  expect(seen[0].model.evidence).toEqual([]);
  expect(seen[0]).toMatchObject({ knowledge: 3, confidence: 3 });

  await click("I see it");

  // The answer travels as evidence. Beliefs are the model's to write, not the arm's.
  const sent = seen.at(-1)!.model;
  expect(sent.evidence).toHaveLength(1);
  expect(sent.evidence[0]).toMatchObject({
    id: "probe:robotics", kind: "choice", topics: ["robotics"],
    prompt: "Question 1", answer: { kind: "binary", direction: "yes" },
  });
  expect(sent.turn).toBe(1);
  expect(statement()).toBe("Question 2");
});

it("records the run as jev when the model read it, and as fallback when it did not", async () => {
  const jev: ProbeFetcher = async input => ({ model: { ...input.model, source: "jev" }, probe: choice("probe:robotics", "Read") });
  await render(jev);
  await foundations();
  expect(loadRuns().at(0)?.source).toBe("jev");

  await act(async () => root.unmount());
  container.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  const pending: ProbeFetcher = async input => ({ model: { ...input.model, source: "pending" }, probe: choice("probe:robotics", "Unread") });
  await render(pending);
  await foundations();
  expect(loadRuns().at(0)?.source).toBe("fallback");
});

it("falls back to the local sequencer when the endpoint fails, rather than stranding anyone", async () => {
  const fetchProbe: ProbeFetcher = vi.fn(async () => { throw new Error("down"); });
  await render(fetchProbe);
  await foundations();
  // The fixed seven-domain order is the floor under the adaptive one: the first
  // domain is Technology, whose first topic is semiconductors, at knowledge 3.
  expect(statement()).toBe("Custom silicon erodes the general-purpose chip margin before demand cools.");
  expect(container.querySelector(".onb-error")).toBeNull();
});

it("reaches the rules scene when the sequencer says the run is over", async () => {
  const done: ProfileModel = { ...newProfileModel(), source: "jev" };
  const fetchProbe: ProbeFetcher = async () => ({ model: done, probe: null });
  await render(fetchProbe);
  await foundations();
  expect(title()).toBe("Your outlook. Your rules.");
});

it("stops at the ceiling of seven probes", async () => {
  let turn = 0;
  const fetchProbe: ProbeFetcher = async input => {
    turn = input.model.turn;
    return turn >= 7
      ? { model: input.model, probe: null }
      : { model: { ...input.model, source: "jev" }, probe: choice(`probe:${turn}`, `Question ${turn + 1}`) };
  };
  await render(fetchProbe);
  await foundations();
  for (let i = 0; i < 7; i++) await click("I see it");
  expect(turn).toBe(7);
  expect(title()).toBe("Your outlook. Your rules.");
});

it("keeps the evidence log intact when a later reading replaces the beliefs", () => {
  const entry = { id: "probe:robotics", at: "2026-09-18T10:00:00.000Z", kind: "choice" as const, prompt: "p", topics: ["robotics" as const], answer: { kind: "binary" as const, direction: "yes" as const } };
  const first = recordEvidence({ ...newProfileModel(), beliefs: [{ topic: "robotics", p: 0.2, certainty: 0.9 }] }, entry);
  const reread: ProfileModel = { ...first, beliefs: [{ topic: "robotics", p: 0.9, certainty: 0.3 }], source: "jev" };
  expect(reread.evidence).toEqual(first.evidence);
});
