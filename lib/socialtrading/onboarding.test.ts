import { describe, expect, it } from "vitest";
import { CATEGORIES, DECK_SIZE, DISLIKES, KEYWORDS, basePrediction, deckProgress, newOnboarding, nextPrediction, onboardingThesis, predictions, readOnboarding, resolveScene, sceneOrder } from "./onboarding";
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
    expect(KEYWORDS).toHaveLength(CATEGORIES.length);
    expect(new Set(KEYWORDS).size).toBe(KEYWORDS.length);
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
    expect(readOnboarding({ ...newOnboarding(), scene: 8 })!.scene).toBe(8);
  });
  it("opens every run on the same AI question, then walks the other domains in a fixed order", () => {
    for (let level = 0; level < 4; level++) expect(basePrediction(level).category).toBe("Society and work");
    const a = newOnboarding();
    a.responses = [{ ...basePrediction(0), direction: "yes", confidence: 80, years: 6 }];
    expect(deckProgress(a)).toBe(0);
    expect(nextPrediction(a, 0)!.category).toBe("Technology");
    expect(nextPrediction({ ...a, responses: [{ ...basePrediction(0), direction: "no" }] }, 0)!.category).toBe("Technology");
    expect(nextPrediction({ ...a, responses: [{ ...basePrediction(0), direction: "unsure" }] }, 0)!.category).toBe("Technology");
  });
  it("covers every remaining domain regardless of how cards were swiped", () => {
    const walk = (direction: "yes" | "no") => {
      let a = { ...newOnboarding(), responses: [{ ...basePrediction(2), direction }] };
      const seen: string[] = [];
      for (let i = 0; i < DECK_SIZE; i++) {
        const card = nextPrediction(a, 2)!;
        expect(card, `card ${i}`).toBeTruthy();
        seen.push(card.category);
        a = { ...a, responses: [...a.responses, { ...card, direction }] };
      }
      expect(nextPrediction(a, 2)).toBeUndefined();
      return seen;
    };
    const yesPath = walk("yes"), noPath = walk("no");
    expect(yesPath).toEqual(noPath);
    expect(yesPath).toEqual(CATEGORIES.filter(c => c !== "Society and work"));
  });
  it("writes easier futures at knowledge 1 and sharper tensions at knowledge 4", () => {
    expect(predictions(0).map(p => p.text)).toEqual([
      "Robots take more physical jobs than they create.",
      "Electricity becomes harder to get than oil.",
      "Crypto becomes everyday money, not just something people trade.",
      "Living healthy into your nineties becomes normal.",
      "Countries make more of their own goods, even if it costs more.",
      "We spend more fixing climate damage than preventing it.",
      "AI takes over more work than it creates.",
    ]);
    expect(predictions(3).find(p => p.category === "Society and work")!.text).toContain("overestimating");
    expect(predictions(0)[0].text).not.toEqual(predictions(3)[0].text);
  });
  it("orders scenes around what was answered and lands stored scenes on a visible one", () => {
    const a = newOnboarding();
    // The chart and the map are base questions now, so every run sees both.
    expect(sceneOrder(a)).toEqual([0, 1, 2, 3, 4, 5, 7, 8]);
    const energy = predictions(2).find(p => p.category === "Energy")!;
    a.responses = [{ ...energy, direction: "yes" }]; a.strongest = [energy.id];
    // Conviction is only asked for a chosen view that has none yet.
    expect(sceneOrder(a)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The opening AI view brings its conviction with it, so it adds no scene.
    const ai = basePrediction(2);
    expect(sceneOrder({ ...a, responses: [{ ...ai, direction: "yes", confidence: 70, years: 5 }], strongest: [ai.id] })).toEqual([0, 1, 2, 3, 4, 5, 7, 8]);
    // Placing the dot must not pull the scene out from under the person on it.
    expect(sceneOrder({ ...a, responses: [{ ...energy, direction: "yes", confidence: 70, years: 5 }] })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(resolveScene({ ...newOnboarding(), scene: 6 })).toBe(5);
    expect(resolveScene({ ...a, scene: 6 })).toBe(6);
  });
});
