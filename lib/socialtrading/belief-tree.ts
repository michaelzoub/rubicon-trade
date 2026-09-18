import type { GraphFrame, GraphNode } from "./memory-graph";
import type { JevAnswers, JevQuestion } from "./jev-types";
import { THEMES } from "./themes";
import { THEME_BEARING, bearing } from "./worldview";

/**
 * A worldview drawn as a tree rather than a ring.
 *
 * The centre is always the thesis. What the thesis rests on sits in the first
 * ring; what those pillars imply — a sector, a ticker, an open question — hangs
 * off whichever pillar it belongs to. Two things are read at a glance: colour
 * is how well-supported a belief is, and distance from the centre is the same
 * number, so the ideas everything else depends on sit closest and greenest.
 *
 * The numbers come from Jev, a decision model that returns a probability
 * distribution and a calibrated confidence instead of prose. This module is
 * pure and browser-safe: it builds the questions, and it builds the tree from
 * whatever came back — including nothing, in which case it falls back to the
 * arithmetic the graph already carried and says so.
 */

export type TreeTier = "root" | "pillar" | "idea";

export type TreeNode = {
  id: string;
  label: string;
  tier: TreeTier;
  /** Null only for the root. */
  parent: string | null;
  /** 0–1. How closely this lines up with the thesis. Drives colour and distance.
   * Null on the root: the thesis is what everything else is measured against,
   * so it has no alignment of its own to report. */
  alignment: number | null;
  /** 0–1. How sure the model is of that number. Zero when nothing scored it. */
  certainty: number;
  /** 0–1. How sure the model is that this hangs off the parent it was given. */
  lineage: number;
  themes: string[];
  /** Where the belief came from, for the gloss. */
  origin: string;
  /** What happened to it since the previous chapter, when it is a belief. */
  change?: GraphNode["change"];
  /** True when a model scored this node rather than local arithmetic. */
  scored: boolean;
  x: number;
  y: number;
};

export type TreeLink = {
  id: string;
  from: string;
  to: string;
  kind: "branch" | "related" | "contradiction";
  /** 0–1. Branches inherit the child's lineage certainty; an unsure branch is drawn faint. */
  strength: number;
};

export type BeliefTree = {
  nodes: TreeNode[];
  links: TreeLink[];
  /** Whether the alignments on this tree were scored by the model or estimated locally. */
  source: "jev" | "local";
};

export const ROOT_ID = "__thesis";

/** The option a belief picks when it belongs under no pillar but the thesis itself. */
const DIRECT = "__direct";

/** Ring radii, as percentages of the field. Confidence pulls a node inward, so
 * "foundational" and "close to the centre" are the same statement. */
const PILLAR_NEAR = 21, PILLAR_FAR = 33;
const IDEA_NEAR = 12, IDEA_FAR = 22;
/** The field is far wider than it is tall, so a true circle would waste it.
 * Vertical radii are scaled to fill the shape without stacking labels. */
const SQUASH = 0.84;
/** Cross-links between cousins are the point of a tree, but a hairball is not. */
const MAX_RELATED = 14;

const ALIGNMENT_LEVELS = [
  "Pulls against the thesis, or has nothing to do with it.",
  "Barely aligned: it touches the thesis at the edges and nothing follows from it.",
  "Loosely aligned: consistent with the thesis, but the thesis would stand without it.",
  "Strongly aligned: a reason the thesis holds, and it shows in what they watch and buy.",
  "Foundational: the thesis is built on it, and most of what they believe follows from it.",
];

const CENTRALITY_LEVELS = [
  "Absent: the thesis has nothing to do with this area.",
  "Barely aligned: it has come up, but the thesis does not lean on it.",
  "Loosely aligned: adjacent to the thesis without being a reason it holds.",
  "Strongly aligned: a stated reason behind several of their positions.",
  "Foundational: the thesis is built on it and most of their other beliefs depend on it.",
];

/** Levels are ordered descriptions; a score is a position on that number line. */
const fromScore = (score: number, levels: number) => (levels > 1 ? Math.min(1, Math.max(0, score / (levels - 1))) : 0);

/**
 * Colour is the alignment, continuously. Sand means it barely lines up with the
 * thesis, amber means it loosely does, green means the thesis is built on it. A
 * ramp rather than three buckets, so an idea moving toward the centre of
 * someone's thinking is visibly on its way there.
 */
const STOPS: { at: number; rgb: [number, number, number] }[] = [
  { at: 0, rgb: [0xb8, 0xac, 0x9e] },
  { at: 0.35, rgb: [0xcb, 0xa5, 0x5e] },
  { at: 0.7, rgb: [0x84, 0xa8, 0x62] },
  { at: 1, rgb: [0x2f, 0x8f, 0x63] },
];

export function alignmentColor(alignment: number): string {
  const value = Math.min(1, Math.max(0, alignment));
  let lower = STOPS[0], upper = STOPS[STOPS.length - 1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (value >= STOPS[i].at && value <= STOPS[i + 1].at) { lower = STOPS[i]; upper = STOPS[i + 1]; break; }
  }
  const span = upper.at - lower.at;
  const t = span === 0 ? 0 : (value - lower.at) / span;
  const channel = (i: number) => Math.round(lower.rgb[i] + (upper.rgb[i] - lower.rgb[i]) * t);
  return `#${[0, 1, 2].map(i => channel(i).toString(16).padStart(2, "0")).join("")}`;
}

/** Plain words for an alignment, for the reveal and for anyone reading with their ears. */
export function alignmentWord(alignment: number): string {
  if (alignment >= 0.8) return "Foundational";
  if (alignment >= 0.6) return "Strongly aligned";
  if (alignment >= 0.4) return "Loosely aligned";
  if (alignment >= 0.2) return "Barely aligned";
  return "Pulls against it";
}

/** The pillars a worldview could rest on: every theme its beliefs touch, plus
 * anything the profile named outright. Deterministic order, because question
 * ids are positional and both sides of the wire must agree on them. */
function pillarThemes(frame: GraphFrame, declared: readonly string[]): string[] {
  const touched = new Set<string>(declared.filter(t => THEMES.some(theme => theme.id === t)));
  for (const node of frame.nodes) for (const theme of node.themes) if (THEMES.some(t => t.id === theme)) touched.add(theme);
  return THEMES.map(t => t.id).filter(id => touched.has(id));
}

/** The beliefs worth drawing, oldest question ids first. Released beliefs stay
 * out of the tree: a tree of what you believe should not be half graveyard. */
const livingNodes = (frame: GraphFrame) => frame.nodes.filter(n => n.change !== "released");

export type TreePlan = {
  themes: string[];
  beliefs: GraphNode[];
  questions: Record<string, JevQuestion>;
  /** The thesis in the investor's own words. It is what the trunk says. */
  thesis: string;
};

/**
 * What to ask Jev about one chapter. Every question the tree could use goes in
 * a single plan: questions are evaluated in parallel, so asking about all of a
 * worldview at once costs a few tokens rather than a few seconds.
 *
 * Ids are positional (`t0`, `c3`, `p3`) and the model never sees them, so they
 * cost nothing and both sides can rebuild the same mapping from the same frame.
 */
export function treePlan(frame: GraphFrame, declaredThemes: readonly string[] = [], thesis = ""): TreePlan {
  const themes = pillarThemes(frame, declaredThemes);
  const beliefs = livingNodes(frame);
  const questions: Record<string, JevQuestion> = {};

  themes.forEach((id, i) => {
    const theme = THEMES.find(t => t.id === id)!;
    questions[`t${i}`] = {
      type: "score",
      instructions: `How closely does ${theme.name} (${theme.note}) line up with this investor's thesis?`,
      criteria: CENTRALITY_LEVELS,
    };
  });

  const options: Record<string, string> = Object.fromEntries(themes.map(id => {
    const theme = THEMES.find(t => t.id === id)!;
    return [id, `${theme.name}: ${theme.note}. The belief is an instance, consequence or instrument of this area.`];
  }));
  options[DIRECT] = "None of the above: this belief is a pillar of the thesis in its own right, not something that follows from one of the areas listed.";

  beliefs.forEach((belief, i) => {
    questions[`c${i}`] = {
      type: "score",
      instructions: `How closely does this line up with the investor's thesis: "${belief.text}"?`,
      criteria: ALIGNMENT_LEVELS,
    };
    questions[`p${i}`] = {
      type: "choice",
      instructions: `Which area does this belief grow out of: "${belief.text}"?`,
      criteria: options,
    };
  });

  return { themes, beliefs, questions, thesis: thesis.trim() };
}

/** The compact picture of the investor that Jev reasons over. Small on purpose:
 * a decision model needs the facts, not the prose around them. */
export function treeState(input: {
  thesis: string;
  watching: { symbol: string; name: string }[];
  learned: { id: string; confidence: number; weight: number; count: number }[];
  decisions: { side: string; symbol: string; reasoning: string }[];
}) {
  return {
    thesis: input.thesis.slice(0, 4000),
    watching: input.watching.slice(0, 40).map(i => `${i.symbol} (${i.name})`),
    learnedInterests: input.learned.slice(0, 20).map(i => ({
      area: THEMES.find(t => t.id === i.id)?.name ?? i.id,
      confidence: Math.round(i.confidence * 100) / 100,
      weight: Math.round(i.weight * 100) / 100,
      interactions: i.count,
    })),
    recentDecisions: input.decisions.slice(0, 25).map(d => `${d.side} ${d.symbol}${d.reasoning ? ` — ${d.reasoning.slice(0, 180)}` : ""}`),
  };
}

/** Evenly spread `count` children across an arc centred on their parent's
 * bearing. A lone child sits straight out from its pillar; a crowded pillar
 * opens up rather than stacking its labels on one line. */
function fan(index: number, count: number): number {
  if (count <= 1) return 0;
  const spread = Math.min(108, 30 + count * 13);
  return -spread / 2 + (spread * index) / (count - 1);
}

/**
 * Preferred bearings turned into an even ring. Geography survives — the ring is
 * turned so it sits as close as it can to where the themes wanted to be, and
 * energy still reads as roughly north — but no two seats can coincide, which is
 * what made the old field pile its labels on top of each other.
 */
function ring(preferred: number[]): number[] {
  const count = preferred.length;
  if (count < 2) return preferred.slice();
  const order = preferred.map((angle, index) => ({ angle, index })).sort((a, b) => a.angle - b.angle || a.index - b.index);
  const slice = 360 / count;
  // The circular mean of "how far each seat would have to move", which is the
  // turn that disturbs the geography least.
  let x = 0, y = 0;
  order.forEach((entry, seat) => {
    const radians = (entry.angle - seat * slice) * Math.PI / 180;
    x += Math.cos(radians); y += Math.sin(radians);
  });
  const turn = Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 ? 0 : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const seats = new Array<number>(count);
  order.forEach((entry, seat) => { seats[entry.index] = (seat * slice + turn) % 360; });
  return seats;
}

const place = (angle: number, radius: number) => ({
  x: 50 + Math.cos(((angle - 90) * Math.PI) / 180) * radius,
  y: 50 + Math.sin(((angle - 90) * Math.PI) / 180) * radius * SQUASH,
});

/**
 * The tree for one chapter. `answers` is whatever Jev returned; pass `null`
 * when it could not be reached and every alignment falls back to the strength
 * the graph already carried, with `source: "local"` so the view can say so.
 */
export function buildTree(frame: GraphFrame, plan: TreePlan, answers: JevAnswers | null): BeliefTree {
  const { themes, beliefs } = plan;
  const scored = answers !== null;

  const score = (id: string, levels: number): { value: number; certainty: number } | null => {
    const answer = answers?.[id];
    if (!answer || answer.type !== "score") return null;
    return { value: fromScore(answer.score, levels), certainty: answer.confidence };
  };

  // Each belief's parent, and how sure the model was of it. Without an answer,
  // a belief falls to the first pillar theme it names, and to the thesis if it
  // names none — the same lineage the ring drawing implied, just made explicit.
  const lineageOf = (belief: GraphNode, i: number): { parent: string; lineage: number } => {
    const answer = answers?.[`p${i}`];
    if (answer && answer.type === "choice" && answer.choice !== DIRECT && themes.includes(answer.choice)) {
      return { parent: `pillar:${answer.choice}`, lineage: answer.confidence };
    }
    if (answer && answer.type === "choice") return { parent: ROOT_ID, lineage: answer.confidence };
    const fallback = belief.themes.find(t => themes.includes(t));
    return { parent: fallback ? `pillar:${fallback}` : ROOT_ID, lineage: 0 };
  };

  const supportOf = (belief: GraphNode, i: number) => {
    const answer = score(`c${i}`, ALIGNMENT_LEVELS.length);
    return answer ? { alignment: answer.value, certainty: answer.certainty, scored: true } : { alignment: belief.strength, certainty: 0, scored: false };
  };

  const ideas = beliefs.map((belief, i) => ({ belief, ...lineageOf(belief, i), ...supportOf(belief, i) }));

  // A pillar with nothing hanging off it and no standing of its own is noise.
  const pillars = themes
    .map((theme, i) => {
      const answer = score(`t${i}`, CENTRALITY_LEVELS.length);
      const children = ideas.filter(idea => idea.parent === `pillar:${theme}`);
      const local = Math.max(0, ...children.map(c => c.alignment));
      return {
        theme,
        alignment: answer ? answer.value : local,
        certainty: answer?.certainty ?? 0,
        scored: Boolean(answer),
        children: children.length,
      };
    })
    // Keeping every pillar that carries something is also what guarantees no
    // belief is left hanging off a parent that was drawn away underneath it.
    .filter(p => p.children > 0 || p.alignment >= 0.5);

  const nodes: TreeNode[] = [];
  const links: TreeLink[] = [];

  // The thesis carries no alignment: it is what everything else is aligned to.
  nodes.push({
    id: ROOT_ID, label: plan.thesis || "Your thesis", tier: "root", parent: null,
    alignment: null, certainty: scored ? 1 : 0, lineage: 1,
    themes, origin: "Everything below is measured against this.", scored, x: 50, y: 50,
  });

  const angleOf = new Map<string, number>([[ROOT_ID, 0]]);
  const radiusOf = new Map<string, number>([[ROOT_ID, 0]]);

  // Siblings are placed strongest first, so the eye walks outward from the
  // thesis in order of conviction.
  const byParent = new Map<string, typeof ideas>();
  for (const idea of ideas) {
    const group = byParent.get(idea.parent) ?? [];
    group.push(idea);
    byParent.set(idea.parent, group);
  }
  for (const group of byParent.values()) group.sort((a, b) => b.alignment - a.alignment || a.belief.id.localeCompare(b.belief.id));

  // The first ring carries everything the thesis rests on directly: the theme
  // pillars, and any belief that is a pillar in its own right. They are relaxed
  // onto an even circle rather than left on their raw bearings — the geography
  // survives, because the ring is turned to sit where the themes wanted it, but
  // nothing is allowed to land on top of anything else.
  const direct = byParent.get(ROOT_ID) ?? [];
  const firstRing = [
    ...pillars.map(p => ({ kind: "pillar" as const, pillar: p, bearing: THEME_BEARING[p.theme] ?? bearing([p.theme], p.theme) })),
    ...direct.map(idea => ({ kind: "idea" as const, idea, bearing: bearing(idea.belief.themes, idea.belief.id) })),
  ];
  const seats = ring(firstRing.map(entry => entry.bearing));

  firstRing.forEach((entry, i) => {
    const angle = seats[i];
    if (entry.kind === "pillar") {
      const id = `pillar:${entry.pillar.theme}`;
      const theme = THEMES.find(t => t.id === entry.pillar.theme)!;
      const radius = PILLAR_NEAR + (1 - entry.pillar.alignment) * (PILLAR_FAR - PILLAR_NEAR);
      angleOf.set(id, angle);
      radiusOf.set(id, radius);
      nodes.push({
        id, label: theme.name, tier: "pillar", parent: ROOT_ID,
        alignment: entry.pillar.alignment, certainty: entry.pillar.certainty, lineage: 1,
        themes: [entry.pillar.theme], origin: theme.note, scored: entry.pillar.scored,
        ...place(angle, radius),
      });
      links.push({ id: `branch:${ROOT_ID}->${id}`, from: ROOT_ID, to: id, kind: "branch", strength: entry.pillar.alignment });
      return;
    }
    const { idea } = entry;
    const radius = PILLAR_NEAR + (1 - idea.alignment) * (PILLAR_FAR - PILLAR_NEAR);
    nodes.push({
      id: idea.belief.id, label: idea.belief.text, tier: "idea", parent: ROOT_ID,
      alignment: idea.alignment, certainty: idea.certainty, lineage: idea.lineage,
      themes: idea.belief.themes, origin: idea.belief.origin, change: idea.belief.change,
      scored: idea.scored, ...place(angle, radius),
    });
    links.push({ id: `branch:${ROOT_ID}->${idea.belief.id}`, from: ROOT_ID, to: idea.belief.id, kind: "branch", strength: idea.lineage || idea.alignment });
  });

  // What each pillar carries fans out around that pillar's own seat.
  for (const [parent, group] of byParent) {
    if (parent === ROOT_ID) continue;
    const base = angleOf.get(parent) ?? 0;
    const from = radiusOf.get(parent) ?? 0;
    group.forEach((idea, i) => {
      // Neighbours alternate in depth as well as angle; two long labels at the
      // same radius is the one thing that makes a field like this unreadable.
      const stagger = (i % 2) * 4.5;
      const radius = from + IDEA_NEAR + (1 - idea.alignment) * (IDEA_FAR - IDEA_NEAR) + stagger;
      nodes.push({
        id: idea.belief.id, label: idea.belief.text, tier: "idea", parent,
        alignment: idea.alignment, certainty: idea.certainty, lineage: idea.lineage,
        themes: idea.belief.themes, origin: idea.belief.origin, change: idea.belief.change,
        scored: idea.scored, ...place(base + fan(i, group.length), radius),
      });
      links.push({ id: `branch:${parent}->${idea.belief.id}`, from: parent, to: idea.belief.id, kind: "branch", strength: idea.lineage || idea.alignment });
    });
  }

  // Cousins: beliefs under different pillars that still share ground. This is
  // the link that says a chipmaker is both an AI belief and a hardware one.
  const drawn = new Set(links.map(l => `${l.from}|${l.to}`));
  const related: TreeLink[] = [];
  for (let i = 0; i < ideas.length && related.length < MAX_RELATED; i++) {
    for (let j = i + 1; j < ideas.length && related.length < MAX_RELATED; j++) {
      const a = ideas[i], b = ideas[j];
      if (a.parent === b.parent) continue;
      if (!a.belief.themes.some(t => b.belief.themes.includes(t))) continue;
      if (drawn.has(`${a.belief.id}|${b.belief.id}`)) continue;
      related.push({ id: `related:${a.belief.id}:${b.belief.id}`, from: a.belief.id, to: b.belief.id, kind: "related", strength: Math.min(a.alignment, b.alignment) });
    }
  }
  links.push(...related);

  const present = new Set(nodes.map(n => n.id));
  for (const edge of frame.edges) {
    if (edge.kind !== "contradiction" || !present.has(edge.from) || !present.has(edge.to)) continue;
    links.push({ id: edge.id, from: edge.from, to: edge.to, kind: "contradiction", strength: 1 });
  }

  return { nodes, links, source: scored ? "jev" : "local" };
}
