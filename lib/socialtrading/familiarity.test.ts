import { describe, expect, it } from "vitest";
import { FAMILIARITY_CONCEPTS, FAMILIARITY_MAX_SCORE, knowledgeFromTier, scoreFamiliarity, shuffleFamiliarityConcepts } from "./familiarity";

describe("investing familiarity scoring", () => {
  it("sums to a maximum of 30 and maps empty selections to tier 1", () => {
    expect(FAMILIARITY_MAX_SCORE).toBe(30);
    expect(scoreFamiliarity([])).toEqual({ familiarityTier: 1, familiarityScore: 0, selectedConceptIds: [] });
  });

  it("maps score bands onto silent tiers", () => {
    expect(scoreFamiliarity([1, 2]).familiarityTier).toBe(1);
    expect(scoreFamiliarity([1, 2, 3, 4, 5]).familiarityScore).toBe(8);
    expect(scoreFamiliarity([1, 2, 3, 4, 5]).familiarityTier).toBe(2);
    expect(scoreFamiliarity([3, 4, 5, 6, 7, 8]).familiarityScore).toBe(14);
    expect(scoreFamiliarity([3, 4, 5, 6, 7, 8]).familiarityTier).toBe(2);
    expect(scoreFamiliarity([7, 8, 9, 10, 11]).familiarityScore).toBe(16);
    expect(scoreFamiliarity([7, 8, 9, 10, 11]).familiarityTier).toBe(3);
    expect(scoreFamiliarity([7, 8, 9, 10, 11, 12]).familiarityScore).toBe(20);
    expect(scoreFamiliarity([7, 8, 9, 10, 11, 12]).familiarityTier).toBe(3);
    expect(scoreFamiliarity([5, 6, 7, 8, 9, 10, 11, 12]).familiarityScore).toBe(24);
    expect(scoreFamiliarity([5, 6, 7, 8, 9, 10, 11, 12]).familiarityTier).toBe(4);
    expect(scoreFamiliarity(FAMILIARITY_CONCEPTS.map(concept => concept.id))).toEqual({
      familiarityTier: 4, familiarityScore: 30, selectedConceptIds: FAMILIARITY_CONCEPTS.map(concept => concept.id),
    });
  });

  it("ignores unknown ids, dedupes, and keeps a stable id order", () => {
    expect(scoreFamiliarity([12, 1, 1, 99, 0])).toEqual({ familiarityTier: 1, familiarityScore: 5, selectedConceptIds: [1, 12] });
  });

  it("maps tiers onto the 0–3 knowledge depth the rest of onboarding already uses", () => {
    expect(knowledgeFromTier(1)).toBe(0);
    expect(knowledgeFromTier(4)).toBe(3);
  });

  it("shuffles without mutating the source list", () => {
    const original = FAMILIARITY_CONCEPTS.map(concept => concept.id);
    const shuffled = shuffleFamiliarityConcepts(original);
    expect(shuffled.sort((a, b) => a - b)).toEqual(original);
    expect(original).toEqual(FAMILIARITY_CONCEPTS.map(concept => concept.id));
  });
});
