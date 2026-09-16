import { describe, expect, it } from "vitest";
import { PREVIEW_STATE } from "../../app/preview/fixture";
import { buildGraph, diffFrame, framesOf, summarise } from "./memory-graph";
import type { MemoryFrame } from "./worldview";
import type { ActivityEvent, HubState } from "./types";

const belief = (id: string, strength: number, themes: string[], text = id): MemoryFrame["convictions"][number] =>
  ({ id, text, strength, themes, origin: "Confirmed by you", updatedAt: "2026-09-10T00:00:00.000Z" });

const frame = (at: string, convictions: MemoryFrame["convictions"]): MemoryFrame =>
  ({ id: at, at, title: at, convictions, interests: [], understanding: [] });

describe("framesOf", () => {
  it("reads the recorded history when there is one", () => {
    expect(framesOf(PREVIEW_STATE).length).toBe(PREVIEW_STATE.worldview?.memories.length || 1);
  });

  it("does not reconstruct a past that was never recorded", () => {
    const blank = { ...structuredClone(PREVIEW_STATE), worldview: undefined } as HubState;
    const frames = framesOf(blank);
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe("now");
  });
});

describe("diffFrame", () => {
  const first = frame("2026-09-01T00:00:00.000Z", [belief("grid", .5, ["energy"])]);

  it("calls a belief new when nothing like it was held before", () => {
    const solo = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("fresh", .4, ["healthcare"])]), undefined, []);
    expect(solo.nodes[0].change).toBe("appeared");
    expect(solo.nodes[0].parent).toBeUndefined();
  });

  it("calls it a branch when it grows beside something already believed", () => {
    const next = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .5, ["energy"]), belief("nuclear", .3, ["energy"])]), first, []);
    const child = next.nodes.find(n => n.id === "nuclear")!;
    expect(child.change).toBe("branched");
    expect(child.parent).toBe("grid");
    expect(next.edges).toContainEqual(expect.objectContaining({ kind: "branch", from: "grid", to: "nuclear" }));
  });

  it("reads strengthening and fading, and ignores a nudge", () => {
    const up = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .7, ["energy"])]), first, []);
    const down = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .3, ["energy"])]), first, []);
    const still = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .52, ["energy"])]), first, []);
    expect(up.nodes[0].change).toBe("strengthened");
    expect(down.nodes[0].change).toBe("faded");
    expect(still.nodes[0].change).toBe("steady");
  });

  it("calls it a contradiction only when a neighbour rises as this one falls", () => {
    const before = frame("2026-09-01T00:00:00.000Z", [belief("grid", .8, ["energy"]), belief("nuclear", .3, ["energy"])]);
    const after = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .4, ["energy"]), belief("nuclear", .6, ["energy"])]), before, []);
    expect(after.nodes.find(n => n.id === "grid")!.change).toBe("contradicted");
    expect(after.edges).toContainEqual(expect.objectContaining({ kind: "contradiction", from: "nuclear", to: "grid" }));

    // The same fall with nothing rising beside it is only a fading belief.
    const alone = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .4, ["energy"]), belief("nuclear", .3, ["energy"])]), before, []);
    expect(alone.nodes.find(n => n.id === "grid")!.change).toBe("faded");
  });

  it("keeps a belief that was let go, drawn going dark", () => {
    const gone = diffFrame(frame("2026-09-02T00:00:00.000Z", []), first, []);
    expect(gone.nodes).toHaveLength(1);
    expect(gone.nodes[0]).toMatchObject({ id: "grid", change: "released", strength: 0 });
  });

  it("connects beliefs that share a theme, and leaves strangers unconnected", () => {
    const mixed = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .5, ["energy"]), belief("care", .5, ["healthcare"])]), undefined, []);
    expect(mixed.edges.filter(e => e.kind === "kin")).toHaveLength(0);
    const kin = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .5, ["energy"]), belief("solar", .5, ["energy"])]), undefined, []);
    expect(kin.edges.filter(e => e.kind === "kin")).toHaveLength(1);
  });

  it("hangs only what happened in this step off the belief it touches", () => {
    const events: ActivityEvent[] = [
      { id: "old", at: "2026-08-20T00:00:00.000Z", kind: "learning", text: "solar interest" },
      { id: "during", at: "2026-09-01T12:00:00.000Z", kind: "trade", text: "Bought a solar utility", tradeId: "t1" },
      { id: "later", at: "2026-09-20T00:00:00.000Z", kind: "learning", text: "more solar" },
      { id: "unrelated", at: "2026-09-01T13:00:00.000Z", kind: "learning", text: "nothing matching" },
    ] as ActivityEvent[];
    const step = diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .5, ["energy"])]), first, events);
    expect(step.satellites.map(s => s.id)).toEqual(["during"]);
    expect(step.satellites[0]).toMatchObject({ belief: "grid", tradeId: "t1" });
  });

  it("places beliefs on the bearings their themes already hold in Explore", () => {
    const north = diffFrame(frame("a", [belief("grid", .9, ["energy"])]), undefined, []).nodes[0];
    const south = diffFrame(frame("a", [belief("coin", .9, ["crypto"])]), undefined, []).nodes[0];
    expect(north.y).toBeLessThan(50);
    expect(south.y).toBeGreaterThan(50);
    // Placement is stable: the same belief never moves between reads.
    expect(diffFrame(frame("a", [belief("grid", .9, ["energy"])]), undefined, []).nodes[0]).toEqual(north);
  });

  it("puts a strongly held belief nearer the centre than a weak one", () => {
    const strong = diffFrame(frame("a", [belief("grid", .95, ["energy"])]), undefined, []).nodes[0];
    const weak = diffFrame(frame("a", [belief("grid", .05, ["energy"])]), undefined, []).nodes[0];
    expect(Math.hypot(strong.x - 50, strong.y - 50)).toBeLessThan(Math.hypot(weak.x - 50, weak.y - 50));
  });
});

describe("buildGraph", () => {
  it("reads every recorded state of mind against the one before it", () => {
    const graph = buildGraph(PREVIEW_STATE);
    expect(graph.length).toBe(framesOf(PREVIEW_STATE).length);
    expect(graph[0].nodes.every(n => ["appeared", "branched"].includes(n.change))).toBe(true);
  });
});

describe("summarise", () => {
  it("says what moved, and says so plainly when nothing did", () => {
    const before = frame("2026-09-01T00:00:00.000Z", [belief("grid", .5, ["energy"])]);
    expect(summarise(diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .5, ["energy"])]), before, []))).toBe("Nothing moved");
    expect(summarise(diffFrame(frame("2026-09-02T00:00:00.000Z", [belief("grid", .8, ["energy"])]), before, []))).toContain("stronger");
  });
});
