import { describe, expect, it } from "vitest";
import { applyAnswer, readCard, readPredictionDeck, type Card } from "./onboarding-cards";
import { CATEGORIES, newOnboarding, onboardingThesis } from "./onboarding";

const valid = { id: "c1", kind: "binary", title: "Robots do most warehouse work.", lead: "Go with your instinct.", category: CATEGORIES[0] };

describe("generated onboarding cards", () => {
  it("accepts a well-formed card and trims it", () => {
    expect(readCard({ ...valid, title: "  Robots do most warehouse work.  " })).toEqual({ ...valid, title: "Robots do most warehouse work." });
  });

  it("rejects anything the model got wrong rather than repairing it", () => {
    expect(readCard(null)).toBeNull();
    expect(readCard("a string")).toBeNull();
    expect(readCard({ ...valid, kind: "freeform" })).toBeNull();
    expect(readCard({ ...valid, category: "Sports" })).toBeNull();
    expect(readCard({ ...valid, title: "" })).toBeNull();
    expect(readCard({ ...valid, title: "x".repeat(141) })).toBeNull();
    expect(readCard({ ...valid, lead: undefined })).toBeNull();
    // A scale needs exactly four stops, and chips need a usable range.
    expect(readCard({ ...valid, kind: "scale", options: ["a", "b", "c"] })).toBeNull();
    expect(readCard({ ...valid, kind: "scale", options: ["a", "b", "c", "d"] })).toMatchObject({ kind: "scale" });
    expect(readCard({ ...valid, kind: "chips", options: ["only"] })).toBeNull();
    expect(readCard({ ...valid, kind: "chips", options: Array(13).fill("x") })).toBeNull();
  });

  it("drops options the model sent for a kind that has none", () => {
    expect(readCard({ ...valid, options: ["stray"] })).not.toHaveProperty("options");
  });

  it("accepts a seven-domain pack and rejects anything missing a domain", () => {
    const predictions = CATEGORIES.map((category, i) => ({ category, statement: `Statement ${i} about ${category}.` }));
    const pack = readPredictionDeck({ predictions });
    expect(pack).toHaveLength(7);
    expect(pack!.map(c => c.category)).toEqual(CATEGORIES);
    expect(readPredictionDeck({ predictions: predictions.slice(1) })).toBeNull();
    expect(readPredictionDeck({ predictions: [...predictions, { category: "Technology", statement: "A second tech take." }] })).toHaveLength(7);
  });
});

describe("folding answers into the shared profile shape", () => {
  const card = (over: Partial<Card> = {}): Card => ({ ...valid, ...over } as Card);

  it("turns a decided view into a response the thesis can use", () => {
    const a = applyAnswer(newOnboarding(), card(), { kind: "binary", direction: "yes" });
    expect(a.responses).toHaveLength(1);
    expect(a.strongest).toEqual(["c1"]);
    expect(onboardingThesis(a)).toContain("I expect: Robots do most warehouse work.");
  });

  it("keeps an unsure answer out of the thesis", () => {
    const a = applyAnswer(newOnboarding(), card(), { kind: "binary", direction: "unsure" });
    expect(a.responses).toHaveLength(1);
    expect(a.strongest).toEqual([]);
  });

  it("caps the thesis at two strong views, as the tree's shortlist does", () => {
    let a = newOnboarding();
    for (const id of ["c1", "c2", "c3"]) a = applyAnswer(a, card({ id }), { kind: "binary", direction: "yes" });
    expect(a.responses).toHaveLength(3);
    expect(a.strongest).toEqual(["c1", "c2"]);
  });

  it("lets a pad deepen the view that has no depth yet", () => {
    let a = applyAnswer(newOnboarding(), card(), { kind: "binary", direction: "yes" });
    a = applyAnswer(a, card({ id: "c2", kind: "pad" }), { kind: "pad", confidence: 88, years: 5 });
    expect(a.responses).toHaveLength(1);
    expect(a.responses[0]).toMatchObject({ id: "c1", confidence: 88, years: 5 });
    expect(onboardingThesis(a)).toContain("88%");
  });

  it("stands a pad up on its own when nothing has been decided yet", () => {
    const a = applyAnswer(newOnboarding(), card({ id: "p1", kind: "pad" }), { kind: "pad", confidence: 70, years: 9 });
    expect(a.responses[0]).toMatchObject({ id: "p1", direction: "yes", confidence: 70, years: 9 });
    expect(a.strongest).toEqual(["p1"]);
  });

  it("puts softer answers into the person's own words, within the stored limit", () => {
    let a = applyAnswer(newOnboarding(), card({ kind: "chips", title: "You care about", options: ["Grids", "Water"] }), { kind: "chips", values: ["Grids", "Water"] });
    expect(a.ownBelief).toBe("You care about Grids, Water.");
    a = applyAnswer(a, card({ id: "t1", kind: "text" }), { kind: "text", value: "Energy decides the decade." });
    expect(a.ownBelief).toContain("Energy decides the decade.");
    a = applyAnswer(a, card({ id: "t2", kind: "text" }), { kind: "text", value: "x".repeat(400) });
    expect(a.ownBelief.length).toBeLessThanOrEqual(300);
  });

  it("records a scale answer by the label that was chosen", () => {
    const a = applyAnswer(newOnboarding(), card({ kind: "scale", title: "Your pace is", options: ["Slow", "Steady", "Fast", "Urgent"] }), { kind: "scale", value: 2 });
    expect(a.ownBelief).toBe("Your pace is Fast.");
  });
});
