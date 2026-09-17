import { describe, expect, it } from "vitest";
import { CATEGORIES, DISLIKES, needsGeography, newOnboarding, onboardingThesis, predictions, readOnboarding, resolveScene, sceneOrder } from "./onboarding";
import { newProfile, readProfile } from "./profile";
describe("decision-tree onboarding", () => {
  it("covers seven distinct domains at all four depths", () => {
    for (let level = 0; level < 4; level++) {
      const deck = predictions(level);
      expect(deck).toHaveLength(7);
      expect(new Set(deck.map(p => p.category)).size).toBe(7);
      expect(deck.map(p => p.category)).toEqual(CATEGORIES);
    }
    expect(predictions(0)[0].text).not.toEqual(predictions(3)[0].text);
  });
  it("preserves negative convictions and uncertainty without inventing belief", () => {
    const a = newOnboarding();
    a.responses = [{ ...predictions(0)[0], direction: "no", confidence: 90, years: 11 }];
    a.strongest = [a.responses[0].id];
    expect(onboardingThesis(a)).toContain("I do not expect:");
    expect(onboardingThesis(a)).toContain("90%");
    expect(onboardingThesis(a)).toContain("more than ten");
    expect(onboardingThesis(newOnboarding())).toContain("not settled on a strong conviction");
  });
  it("roundtrips the complete profile and all strong dislikes through server validation", () => {
    const p = newProfile("alice");
    p.investorAnswers.knowledge = 3;
    p.investorAnswers.onboarding = { ...newOnboarding(), scene: 6, confidence: 3, dislikes: DISLIKES, ownBelief: "Energy matters." };
    p.thesis = onboardingThesis(p.investorAnswers.onboarding);
    p.permissionConfigured = true; p.step = 6; p.completedAt = new Date().toISOString();
    expect(readProfile(JSON.stringify(p), "alice").investorAnswers.onboarding).toEqual(p.investorAnswers.onboarding);
  });
  it("sanitizes invalid maps, dislikes, and strongest selections", () => {
    const a = readOnboarding({ ...newOnboarding(), scene: 999, confidence: 10, dislikes: ["invented", "Tobacco"], openToEverything: true, responses: [{ ...predictions(0)[0], direction: "unsure", confidence: 500, years: -10 }], strongest: ["0-0"] })!;
    expect(a.scene).toBe(0); expect(a.confidence).toBeNull(); expect(a.dislikes).toEqual(["Tobacco"]); expect(a.openToEverything).toBe(false); expect(a.strongest).toEqual([]); expect(a.responses[0].confidence).toBeUndefined();
    expect(readOnboarding({ ...newOnboarding(), scene: 7 })!.scene).toBe(7);
  });
  it("asks about geography only when predictions, dislikes, or the own belief point at it", () => {
    const a = newOnboarding();
    expect(needsGeography(a)).toBe(false);
    const energy = predictions(2).find(p => p.category === "Energy")!;
    a.responses = [{ ...energy, direction: "yes" }];
    expect(needsGeography(a)).toBe(false);
    a.strongest = [energy.id];
    expect(needsGeography(a)).toBe(true);
    const geopolitics = predictions(1).find(p => p.category === "Government and geopolitics")!;
    expect(needsGeography({ ...newOnboarding(), responses: [{ ...geopolitics, direction: "no" }], strongest: [geopolitics.id] })).toBe(true);
    const tech = predictions(0)[0];
    expect(needsGeography({ ...newOnboarding(), responses: [{ ...tech, direction: "yes" }], strongest: [tech.id] })).toBe(false);
    expect(needsGeography({ ...newOnboarding(), dislikes: ["Defence and weapons"] })).toBe(true);
    expect(needsGeography({ ...newOnboarding(), dislikes: ["Tobacco"] })).toBe(false);
    expect(needsGeography({ ...newOnboarding(), ownBelief: "Energy security decides the decade." })).toBe(true);
    expect(needsGeography({ ...newOnboarding(), ownBelief: "Robots everywhere." })).toBe(false);
  });
  it("orders scenes around what was answered and lands stored scenes on a visible one", () => {
    const a = newOnboarding();
    expect(sceneOrder(a)).toEqual([0, 1, 2, 3, 5, 7]);
    const energy = predictions(2).find(p => p.category === "Energy")!;
    a.responses = [{ ...energy, direction: "yes" }]; a.strongest = [energy.id];
    expect(sceneOrder(a)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(resolveScene({ ...newOnboarding(), scene: 6 })).toBe(5);
    expect(resolveScene({ ...newOnboarding(), scene: 4 })).toBe(3);
    expect(resolveScene({ ...a, scene: 6 })).toBe(6);
  });
});
