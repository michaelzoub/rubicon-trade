import { describe, expect, it } from "vitest";
import { auraLobes, identityDepth, identityLine, identitySignature, identityStage, identityStats, milestones, nextStep, seededRandom, STAGES } from "./identity";
import { newProfile } from "./profile";
import type { HubState } from "./types";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

const empty = (): HubState => ({
  revision: 0, profile: newProfile("u1"), dislikes: [], preferences: [],
  inferred: [], signals: [], chats: [], events: [], trades: [],
});
const lived = (): HubState => ({
  ...empty(),
  profile: { ...newProfile("u1"), thesis: "Power is the bottleneck.", themes: ["ai", "energy"], completedAt: ago(9), interests: [
    { id: "NVDA", symbol: "NVDA", name: "Nvidia", kind: "stock" },
    { id: "VRT", symbol: "VRT", name: "Vertiv", kind: "stock" },
    { id: "CRWV", symbol: "CRWV", name: "CoreWeave", kind: "stock" },
  ] },
  preferences: ["nuclear"], dislikes: ["memecoins"],
  inferred: [
    { id: "energy", weight: .62, confidence: .67, count: 10, updatedAt: ago(0) },
    { id: "OKLO", weight: .38, confidence: .5, count: 5, updatedAt: ago(0) },
  ],
  events: [{ id: "e1", at: ago(9), kind: "profile", text: "Started" }, { id: "e2", at: ago(1), kind: "learning", text: "Noticed" }],
  chats: [{ id: "c1", title: "t", createdAt: ago(9), updatedAt: ago(1), messages: [] }],
});
const agent = (id: string, enabled: boolean, createdAt: string) => ({ id, name: id, description: "", capabilities: [], createdAt, enabled, notifications: { cadenceMinutes: 60, threshold: "medium" as const, maxPerDay: 3 } });

describe("seeded identity", () => {
  it("gives the same aura to the same person every time and different auras to different people", () => {
    const a = auraLobes("u1", ["ai", "energy"]), b = auraLobes("u1", ["ai", "energy"]), c = auraLobes("u2", ["ai", "energy"]);
    expect(a).toEqual(b);
    expect(a.map(l => [l.x, l.y])).not.toEqual(c.map(l => [l.x, l.y]));
  });
  it("stays inside the box and keeps the seeded stream in 0–1", () => {
    const random = seededRandom("u1");
    const draws = Array.from({ length: 200 }, random);
    expect(Math.min(...draws)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...draws)).toBeLessThan(1);
    for (const lobe of auraLobes("u1", ["ai", "energy", "crypto", "tech"])) {
      expect(lobe.x).toBeGreaterThan(50); expect(lobe.x).toBeLessThan(270);
      expect(lobe.y).toBeGreaterThan(50); expect(lobe.y).toBeLessThan(270);
    }
  });
  it("still composes an aura before any theme is chosen", () => {
    expect(auraLobes("u1", [])).toHaveLength(3);
  });
  it("lets an inferred theme in at a lighter weight than one that was chosen", () => {
    const lobes = auraLobes("u1", ["ai"], [{ id: "energy", weight: .62, confidence: .67, count: 10, updatedAt: ago(0) }]);
    expect(lobes.map(l => l.id)).toEqual(["ai", "energy"]);
    expect(lobes[1].weight).toBeLessThan(lobes[0].weight);
  });
  it("ignores an inferred theme the agent is not yet sure about", () => {
    expect(auraLobes("u1", ["ai"], [{ id: "crypto", weight: .12, confidence: .2, count: 1, updatedAt: ago(0) }])).toHaveLength(1);
  });
});

describe("stats", () => {
  it("counts what the person did, not what the system stored", () => {
    const stats = identityStats(lived(), [agent("a", true, ago(9)), agent("b", false, ago(2))], NOW);
    expect(stats).toMatchObject({ signals: 15, watching: 3, discoveries: 1, themes: 2, agents: 2, awake: 1, days: 9, conversations: 1 });
  });
  it("counts only the last seven days as energy", () => {
    expect(identityStats(lived(), [], NOW).energy).toBe(1);
  });
  it("survives an account with nothing in it", () => {
    expect(identityStats(empty(), [], NOW)).toMatchObject({ signals: 0, days: 0, agents: 0 });
  });
});

describe("stage", () => {
  it("starts everyone at Forming and never runs past the last stage", () => {
    expect(identityStage(0)).toMatchObject({ name: "Forming", index: 0 });
    expect(identityStage(10_000)).toMatchObject({ name: STAGES.at(-1)!.name, progress: 1, next: null });
  });
  it("reports progress through the current stage, not overall", () => {
    const stage = identityStage(50);
    expect(stage.name).toBe("Emerging");
    expect(stage.progress).toBeCloseTo(.5, 5);
    expect(stage.next).toBe("Defined");
  });
  it("moves up as someone puts more in", () => {
    const state = lived(), stats = identityStats(state, [agent("a", true, ago(9))], NOW);
    const before = identityDepth(state, stats);
    const after = identityDepth({ ...state, trades: [{ id: "t" } as HubState["trades"][number]] }, { ...stats, trades: 1 });
    expect(after).toBeGreaterThan(before);
    expect(identityStage(before).index).toBeGreaterThan(0);
  });
});

describe("what to do next", () => {
  it("asks for a point of view before anything else", () => {
    expect(nextStep(empty(), identityStats(empty(), [], NOW), 3)).toMatch(/believe/);
  });
  it("moves on once the earlier steps are done", () => {
    const state = lived(), stats = identityStats(state, [agent("a", true, ago(9))], NOW);
    expect(nextStep(state, stats, 3)).toMatch(/another agent/);
    expect(nextStep(state, { ...stats, agents: 3 }, 3)).toMatch(/exploring/);
  });
});

describe("milestones", () => {
  it("earns nothing on an empty account and says what each one takes", () => {
    const earned = milestones(empty(), identityStats(empty(), [], NOW));
    expect(earned.every(m => !m.earned)).toBe(true);
    expect(earned.every(m => m.note.length > 0)).toBe(true);
  });
  it("earns the ones the person has actually reached", () => {
    const state = lived(), stats = identityStats(state, [agent("a", true, ago(9))], NOW);
    const earned = Object.fromEntries(milestones(state, stats).map(m => [m.id, m.earned]));
    expect(earned).toMatchObject({ thesis: true, themes: true, watching: true, listening: true, awake: true, team: false, move: false, read: false });
  });
});

describe("how it reads", () => {
  it("names chosen themes, falls back to what the agent worked out, then stays honest", () => {
    expect(identityLine(["ai", "energy"])).toBe("AI × Energy");
    expect(identityLine([], [{ id: "energy", weight: .62, confidence: .67, count: 10, updatedAt: ago(0) }])).toBe("Energy, so far");
    expect(identityLine([], [])).toBe("Still open");
  });
  it("prints a stable signature", () => {
    expect(identitySignature("u1", 9)).toBe(identitySignature("u1", 9));
    expect(identitySignature("u1", 9)).toMatch(/^AUR·[0-9A-F]{4}\s+·\s+DAY 9$/);
    expect(identitySignature("u1", 9)).not.toBe(identitySignature("u2", 9));
  });
});
