import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./onboarding";
import { KNOWLEDGE_VOICE, deckPrompt, deckSystem, nextCardPrompt, storedToVoice, swipeSystem } from "./onboarding-voice";

describe("onboarding swipe voice", () => {
  it("maps stored 0–3 answers onto spoken levels 1–4", () => {
    expect(storedToVoice(null)).toBeNull();
    expect(storedToVoice(-1)).toBeNull();
    expect(storedToVoice(0)).toBe(1);
    expect(storedToVoice(3)).toBe(4);
    expect(Object.keys(KNOWLEDGE_VOICE)).toEqual(["1", "2", "3", "4"]);
  });

  it("asks for easy directional bets at knowledge 1 and opposing views at 4", () => {
    const beginner = deckPrompt({ knowledge: 0, confidence: 0 });
    const expert = deckPrompt({ knowledge: 3, confidence: 3 });
    expect(beginner).toContain("Knowledge 1/4");
    expect(beginner).toContain("easy directional bets");
    expect(beginner).toContain("Robots take more physical jobs than they create.");
    expect(deckSystem()).toContain("almost everyone would accept");
    expect(expert).toContain("Knowledge 4/4");
    expect(expert).toContain("opposing views");
    expect(expert).toContain("overestimating");
    expect(deckSystem()).toContain("exactly 7");
    expect(deckSystem()).toContain("At most ONE statement may mention AI");
  });

  it("pins a domain without letting a previous swipe choose the next question", () => {
    const next = nextCardPrompt({
      knowledge: 2, confidence: 2, ownBelief: "", asked: ["Robots take over warehouses."], kinds: ["binary"], intent: "swipe",
      focusCategory: "Energy",
      priors: [{ text: "Robots take over warehouses.", direction: "yes", category: "Technology" }],
    });
    expect(next).toContain(`category "${CATEGORIES[1]}"`);
    expect(next).toContain("Do not follow on from a previous swipe");
    expect(next).not.toContain("consequence of that belief");
    expect(swipeSystem()).not.toContain("The answer chooses the NEXT question");
  });
});
