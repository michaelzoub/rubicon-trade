import { describe, expect, it } from "vitest";
import { alignmentColor, alignmentWord, buildTree, ROOT_ID, treePlan, treeState } from "./belief-tree";
import type { JevAnswers, JevQuestion } from "./jev-types";
import type { GraphFrame, GraphNode } from "./memory-graph";

const belief = (id: string, text: string, themes: string[], strength = 0.5): GraphNode =>
  ({ id, text, origin: "Your stated thesis", strength, themes, change: "steady", x: 0, y: 0 });

const frameOf = (nodes: GraphNode[], edges: GraphFrame["edges"] = []): GraphFrame =>
  ({ id: "f1", at: "2026-09-18T00:00:00Z", title: "Now", nodes, edges, satellites: [] });

/** The score that lands on level `level` of a five-level question. */
const score = (level: number, confidence = 0.9) =>
  ({ type: "score" as const, score: level, legend: {}, probabilities: {}, confidence });
const choice = (option: string, confidence = 0.9) =>
  ({ type: "choice" as const, choice: option, probabilities: { [option]: confidence }, confidence });

const radius = (node: { x: number; y: number }) => Math.hypot(node.x - 50, node.y - 50);

describe("treePlan", () => {
  it("asks about every theme the beliefs touch and two questions per belief", () => {
    const frame = frameOf([belief("b0", "AI compute is the bottleneck", ["ai"]), belief("b1", "Nuclear powers it", ["energy"])]);
    const plan = treePlan(frame);
    // Themes keep THEMES order, not first-seen order, so ids are stable.
    expect(plan.themes).toEqual(["energy", "ai"]);
    expect(Object.keys(plan.questions).sort()).toEqual(["c0", "c1", "p0", "p1", "t0", "t1"]);
    const parent = plan.questions.p0 as Extract<JevQuestion, { type: "choice" }>;
    expect(Object.keys(parent.criteria).sort()).toEqual(["__direct", "ai", "energy"]);
    expect((plan.questions.c0 as Extract<JevQuestion, { type: "score" }>).criteria).toHaveLength(5);
    expect(plan.questions.c0.instructions).toContain("AI compute is the bottleneck");
  });

  it("is deterministic, so the client rebuilds the same ids the server asked with", () => {
    const frame = frameOf([belief("b0", "One", ["ai"]), belief("b1", "Two", ["crypto"])]);
    expect(JSON.stringify(treePlan(frame))).toBe(JSON.stringify(treePlan(frame)));
  });

  it("leaves released beliefs out: a tree of what you believe is not a graveyard", () => {
    const gone = { ...belief("b1", "Let go", ["ai"]), change: "released" as const };
    const plan = treePlan(frameOf([belief("b0", "Held", ["ai"]), gone]));
    expect(plan.beliefs.map(b => b.id)).toEqual(["b0"]);
  });
});

describe("buildTree with Jev answers", () => {
  const frame = frameOf([
    belief("ai-core", "Inference demand outruns supply", ["ai"], 0.2),
    belief("nvda", "Growing interest in NVDA", ["ai"], 0.2),
    belief("grid", "The grid is the real constraint", ["energy"], 0.2),
  ]);
  const plan = treePlan(frame);
  // t0 energy, t1 ai; c0/p0 ai-core, c1/p1 nvda, c2/p2 grid.
  const answers: JevAnswers = {
    t0: score(2, 0.7), t1: score(4, 0.95),
    c0: score(4, 0.9), p0: choice("__direct", 0.8),
    c1: score(2, 0.6), p1: choice("ai", 0.88),
    c2: score(3, 0.8), p2: choice("energy", 0.7),
  };
  const tree = buildTree(frame, plan, answers);
  const at = (id: string) => tree.nodes.find(n => n.id === id)!;

  it("roots everything in the thesis and reports that a model scored it", () => {
    expect(tree.source).toBe("jev");
    expect(at(ROOT_ID)).toMatchObject({ tier: "root", parent: null, x: 50, y: 50 });
  });

  it("gives the thesis no alignment of its own, because it is what the rest is aligned to", () => {
    expect(at(ROOT_ID).alignment).toBeNull();
    expect(tree.nodes.filter(n => n.alignment === null)).toHaveLength(1);
  });

  it("turns a five-level score into a 0-1 alignment and keeps the model's certainty apart from it", () => {
    expect(at("ai-core").alignment).toBeCloseTo(1);
    expect(at("nvda").alignment).toBeCloseTo(0.5);
    expect(at("nvda").certainty).toBeCloseTo(0.6);
    expect(at("nvda").lineage).toBeCloseTo(0.88);
    expect(at("pillar:ai").alignment).toBeCloseTo(1);
  });

  it("hangs a specific idea off the pillar Jev chose, and a pillar off the thesis", () => {
    expect(at("nvda")).toMatchObject({ tier: "idea", parent: "pillar:ai" });
    expect(at("grid")).toMatchObject({ tier: "idea", parent: "pillar:energy" });
    expect(at("pillar:ai")).toMatchObject({ tier: "pillar", parent: ROOT_ID });
    // `__direct` means the belief is a pillar of the thesis in its own right.
    expect(at("ai-core").parent).toBe(ROOT_ID);
    expect(tree.links.some(l => l.kind === "branch" && l.from === "pillar:ai" && l.to === "nvda")).toBe(true);
  });

  it("puts the confident pillar closer to the centre than the doubtful one", () => {
    expect(radius(at("pillar:ai"))).toBeLessThan(radius(at("pillar:energy")));
  });

  it("draws every idea further out than the pillar it hangs off", () => {
    expect(radius(at("nvda"))).toBeGreaterThan(radius(at("pillar:ai")));
  });

  it("links cousins under different pillars that still share ground", () => {
    const shared = frameOf([belief("a", "A", ["ai", "energy"]), belief("b", "B", ["energy", "ai"])]);
    const sharedPlan = treePlan(shared);
    const cousins = buildTree(shared, sharedPlan, { p0: choice("ai"), p1: choice("energy") });
    expect(cousins.links.some(l => l.kind === "related" && l.from === "a" && l.to === "b")).toBe(true);
  });

  it("carries a contradiction through as its own kind of link", () => {
    const contradicted = frameOf(
      [belief("a", "A", ["ai"]), belief("b", "B", ["ai"])],
      [{ id: "against:a->b", from: "a", to: "b", kind: "contradiction" }],
    );
    const built = buildTree(contradicted, treePlan(contradicted), null);
    expect(built.links.find(l => l.id === "against:a->b")?.kind).toBe("contradiction");
  });
});

describe("the first ring", () => {
  it("gives everything the thesis rests on a seat of its own, however the themes bunch up", () => {
    // Five beliefs that all want the same bearing, which is what used to pile
    // them on top of each other in one corner of the field.
    const frame = frameOf(Array.from({ length: 5 }, (_, i) => belief(`b${i}`, `Belief ${i}`, ["ai"], 0.5)));
    const plan = treePlan(frame);
    const tree = buildTree(frame, plan, Object.fromEntries(plan.beliefs.map((_, i) => [`p${i}`, choice("__direct")])));
    const seats = tree.nodes.filter(n => n.parent === ROOT_ID);
    expect(seats).toHaveLength(5);
    // No two share a position, and none of them lands on the trunk.
    const places = seats.map(n => `${n.x.toFixed(2)},${n.y.toFixed(2)}`);
    expect(new Set(places).size).toBe(5);
    for (const seat of seats) expect(radius(seat)).toBeGreaterThan(10);
  });

  it("still points a theme roughly where that theme has always pointed", () => {
    // Energy is north in Explore, so an energy-only worldview stays north here.
    const frame = frameOf([belief("b0", "The grid is the constraint", ["energy"])]);
    const tree = buildTree(frame, treePlan(frame), null);
    const pillar = tree.nodes.find(n => n.id === "pillar:energy")!;
    expect(pillar.y).toBeLessThan(50);
    expect(Math.abs(pillar.x - 50)).toBeLessThan(1);
  });
});

describe("buildTree without Jev", () => {
  const frame = frameOf([belief("nvda", "Growing interest in NVDA", ["ai"], 0.8), belief("stray", "Something unclassified", [], 0.3)]);
  const tree = buildTree(frame, treePlan(frame), null);
  const at = (id: string) => tree.nodes.find(n => n.id === id)!;

  it("says so, rather than presenting an estimate as a score", () => {
    expect(tree.source).toBe("local");
    expect(at("nvda").scored).toBe(false);
    expect(at("nvda").certainty).toBe(0);
  });

  it("falls back to the recorded strength and to the belief's own themes for lineage", () => {
    expect(at("nvda").alignment).toBeCloseTo(0.8);
    expect(at("nvda").parent).toBe("pillar:ai");
    // Nothing to hang it on, so it hangs on the thesis rather than on nothing.
    expect(at("stray").parent).toBe(ROOT_ID);
  });

  it("gives an empty worldview a trunk and nothing else", () => {
    const empty = frameOf([]);
    const built = buildTree(empty, treePlan(empty), null);
    expect(built.nodes).toHaveLength(1);
    expect(built.nodes[0].id).toBe(ROOT_ID);
  });
});

describe("pruning", () => {
  // `healthcare` is declared on the profile, so it is asked about, but nothing
  // in the worldview actually chooses it. Themes keep THEMES order: ai, then healthcare.
  const frame = frameOf([belief("b0", "AI is the story", ["ai"])]);
  const plan = treePlan(frame, ["healthcare"]);

  it("drops a pillar that carries nothing and that the model calls absent", () => {
    expect(plan.themes).toEqual(["ai", "healthcare"]);
    const tree = buildTree(frame, plan, { t0: score(4), t1: score(0), c0: score(4), p0: choice("ai") });
    expect(tree.nodes.some(n => n.id === "pillar:healthcare")).toBe(false);
    expect(tree.nodes.some(n => n.id === "pillar:ai")).toBe(true);
  });

  it("keeps an empty pillar the model calls central, because the absence is the point", () => {
    const tree = buildTree(frame, plan, { t0: score(4), t1: score(3), c0: score(4), p0: choice("ai") });
    expect(tree.nodes.find(n => n.id === "pillar:healthcare")).toMatchObject({ tier: "pillar", parent: ROOT_ID });
  });

  it("never leaves a belief hanging off a pillar that was drawn away", () => {
    const tree = buildTree(frame, plan, { t0: score(0), t1: score(0), c0: score(1), p0: choice("ai") });
    const ids = new Set(tree.nodes.map(n => n.id));
    for (const node of tree.nodes) if (node.parent) expect(ids.has(node.parent)).toBe(true);
  });
});

describe("reading alignment", () => {
  it("runs sand to green across the range, without repeating a colour at the ends", () => {
    expect(alignmentColor(0)).toBe("#b8ac9e");
    expect(alignmentColor(1)).toBe("#2f8f63");
    expect(alignmentColor(0.35)).toBe("#cba55e");
    // Out of range values are clamped rather than producing nonsense hex.
    expect(alignmentColor(-2)).toBe("#b8ac9e");
    expect(alignmentColor(9)).toBe("#2f8f63");
  });

  it("says the same thing in words for anyone reading with their ears", () => {
    expect(alignmentWord(0.95)).toBe("Foundational");
    expect(alignmentWord(0.45)).toBe("Loosely aligned");
    expect(alignmentWord(0.05)).toBe("Pulls against it");
  });
});

describe("treeState", () => {
  it("sends the facts a decision model needs and caps what it sends", () => {
    const built = treeState({
      thesis: "AI needs power.",
      watching: Array.from({ length: 60 }, (_, i) => ({ symbol: `S${i}`, name: `Name ${i}` })),
      learned: [{ id: "ai", confidence: 0.6666, weight: 0.5, count: 12 }],
      decisions: [{ side: "buy", symbol: "NVDA", reasoning: "Compute bottleneck" }],
    });
    expect(built.watching).toHaveLength(40);
    expect(built.watching[0]).toBe("S0 (Name 0)");
    expect(built.learnedInterests[0]).toEqual({ area: "AI", confidence: 0.67, weight: 0.5, interactions: 12 });
    expect(built.recentDecisions[0]).toBe("buy NVDA — Compute bottleneck");
  });
});
