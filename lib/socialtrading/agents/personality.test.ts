import { expect, it } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import type { HubState } from "../types";
import { agentVoice } from "./personality";

const state = (patch: Partial<HubState["profile"]> = {}, rest: Partial<HubState> = {}): HubState => {
  const base = structuredClone(PREVIEW_STATE);
  return { ...base, ...rest, profile: { ...base.profile, ...patch } };
};

it("reads depth, lens and stance from onboarding instead of a typed personality", () => {
  const beginner = agentVoice(state({ themes: ["energy"], permission: "notify", investorAnswers: { knowledge: 0, guidedTest: true, opportunityDrivers: ["Human progress"], esgPriority: 4, aiPriority: 3, technologies: ["Clean energy", "Longevity"], conflictCountries: [], geopoliticalThesis: "", futureVision: "Cheap power everywhere" } }));
  expect(beginner).toContain("Your beat is Energy");
  expect(beginner).toContain("patient friend");
  expect(beginner).toContain("longer, healthier, cleaner lives");
  expect(beginner).toContain("Impact matters as much as returns");
  expect(beginner).toContain("Responsible AI");
  expect(beginner).toContain("Clean energy, Longevity");
  expect(beginner).toContain("Cheap power everywhere");
  expect(beginner).toContain("Never push toward action");

  const expert = agentVoice(state({ themes: ["ai", "crypto"], permission: "automatic", investorAnswers: { knowledge: 4, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "" } }));
  expect(expert).toContain("Your beat is AI and Crypto");
  expect(expert).toContain("peer to peer");
  expect(expert).toContain("Be decisive inside their limits");
  expect(expert).not.toContain("Impact");
  expect(expert).not.toContain("Responsible AI");
});

it("keeps shifting with what the agent has learned in conversation", () => {
  const voice = agentVoice(state({}, { preferences: ["small caps", "founder-led"], dislikes: ["meme coins"] }));
  expect(voice).toContain("small caps, founder-led");
  expect(voice).toContain("Go easy on what they asked to see less of: meme coins");
  expect(voice).toContain("update_profile");
});

it("falls back gracefully when onboarding was skipped", () => {
  const voice = agentVoice(state({ themes: [], thesis: "", investorAnswers: { knowledge: null, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "" } }, { preferences: [], dislikes: [] }));
  expect(voice).toContain("whatever their thesis points at");
  expect(voice).toContain("Assume they know the basics");
});

it("handles legacy state that has no investor answers", () => {
  const legacy = state();
  (legacy.profile as unknown as { investorAnswers?: unknown }).investorAnswers = undefined;
  expect(() => agentVoice(legacy)).not.toThrow();
  expect(agentVoice(legacy)).toContain("Assume they know the basics");
});
