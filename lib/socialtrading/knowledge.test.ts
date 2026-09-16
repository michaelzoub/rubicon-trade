import { describe, expect, it } from "vitest";
import { PREVIEW_STATE } from "../../app/preview/fixture";
import { knowledgeOf, knowledgePoint } from "./knowledge";
import { identityDepth, identityStats } from "./identity";
import type { HubState } from "./types";

const read = (state: HubState) => {
  const stats = identityStats(state, state.agent ? [state.agent] : []);
  return knowledgeOf(state, stats, identityDepth(state, stats));
};

describe("knowledgeOf", () => {
  it("covers every part of what the agent knows, and points each at where it is edited", () => {
    const areas = read(PREVIEW_STATE);
    expect(areas.map(a => a.id)).toEqual(["convictions", "interests", "understanding", "behaviours", "discoveries", "signals", "progression"]);
    expect(areas.every(a => a.facet.length > 0)).toBe(true);
  });

  it("keeps every reading inside nothing-to-everything", () => {
    for (const area of read(PREVIEW_STATE)) {
      expect(area.known).toBeGreaterThanOrEqual(0);
      expect(area.known).toBeLessThanOrEqual(1);
      expect(area.confidence).toBeGreaterThanOrEqual(0);
      expect(area.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("shows an empty account as gaps rather than as zeroes dressed up", () => {
    const blank: HubState = {
      ...structuredClone(PREVIEW_STATE),
      profile: { ...structuredClone(PREVIEW_STATE.profile), thesis: "", themes: [], interests: [] },
      inferred: [], preferences: [], dislikes: [], events: [], trades: [], worldview: undefined,
    };
    const areas = read(blank);
    expect(areas.every(a => a.known === 0 || a.id === "progression")).toBe(true);
    // Each gap says what would fill it, and says it only where there is one.
    expect(areas.filter(a => a.gap).length).toBeGreaterThan(4);
    expect(areas.find(a => a.id === "interests")!.detail).toBe("Nothing being watched");
  });

  it("closes a gap once there is enough there", () => {
    const areas = read(PREVIEW_STATE);
    const filled = areas.filter(a => a.gap === null);
    expect(filled.length).toBeGreaterThan(0);
    for (const area of filled) expect(area.known).toBeGreaterThan(0);
  });

  it("grows with what the person actually put in", () => {
    const more: HubState = {
      ...structuredClone(PREVIEW_STATE),
      preferences: ["nuclear", "grid", "storage", "uranium"],
      dislikes: ["meme coins", "leverage"],
    };
    expect(read(more).find(a => a.id === "behaviours")!.known)
      .toBeGreaterThan(read(PREVIEW_STATE).find(a => a.id === "behaviours")!.known);
  });
});

describe("knowledgePoint", () => {
  it("rings the areas evenly, starting at the top", () => {
    const first = knowledgePoint(0, 4);
    expect(first.x).toBeCloseTo(50);
    expect(first.y).toBeLessThan(50);
    const points = Array.from({ length: 7 }, (_, i) => knowledgePoint(i, 7));
    expect(new Set(points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size).toBe(7);
  });
});
