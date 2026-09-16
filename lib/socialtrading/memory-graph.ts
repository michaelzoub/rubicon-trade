import type { ActivityEvent, HubState } from "./types";
import { bearing, convictionsOf, type Conviction, type MemoryFrame } from "./worldview";
import { THEMES } from "./themes";

/**
 * A worldview over time, read out of the snapshots that were already being
 * kept. Nothing here is invented: every verb below is a difference between two
 * consecutive recorded frames, and a belief with no recorded past simply has
 * none.
 */

/** What happened to a belief between one frame and the next. */
export type BeliefChange = "appeared" | "branched" | "strengthened" | "faded" | "contradicted" | "released" | "steady";

export type GraphNode = {
  id: string; text: string; origin: string;
  /** 0–1. Zero means the belief has been let go and is drawn going dark. */
  strength: number;
  themes: string[];
  change: BeliefChange;
  /** The belief this one grew out of, when it arrived sharing a theme. */
  parent?: string;
  /** Position in a 100x100 field, on the same bearings Explore uses. */
  x: number; y: number;
};

export type GraphEdge = { id: string; from: string; to: string; kind: "kin" | "branch" | "contradiction" };

/** Something that happened between two states of mind, hung off the belief it touches. */
export type Satellite = { id: string; at: string; text: string; kind: ActivityEvent["kind"]; belief: string; tradeId?: string };

export type GraphFrame = {
  id: string; at: string; title: string;
  nodes: GraphNode[]; edges: GraphEdge[]; satellites: Satellite[];
};

/** Movement smaller than this is noise, not a change of mind. */
const NUDGE = 0.05;
/** A drop this large, while a neighbour rises, is a belief being contradicted. */
const RECOIL = 0.2;

function scatter(id: string): number {
  let state = 2166136261;
  for (const char of `rubicon-memory-v1:${id}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return ((state >>> 0) % 1000) / 1000;
}

/** Beliefs sit on the same bearings their themes hold in Explore, so one
 * world's geography carries into the other. */
function place(conviction: Conviction, index: number): { x: number; y: number } {
  const roll = scatter(conviction.id);
  const angle = bearing(conviction.themes, conviction.id) + (roll - .5) * 26;
  const radius = 16 + (1 - conviction.strength) * 24 + (index % 3) * 2.5;
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 50 + Math.cos(radians) * radius, y: 50 + Math.sin(radians) * radius };
}

const shares = (a: readonly string[], b: readonly string[]) => a.some(theme => b.includes(theme));

function themesOfEvent(event: ActivityEvent): string[] {
  const text = `${event.text} ${event.detail ?? ""}`;
  return THEMES.filter(t => t.keywords.test(text)).map(t => t.id);
}

/** The frames to read. Without a recorded history there is exactly one: now. */
export function framesOf(state: HubState): MemoryFrame[] {
  const recorded = state.worldview?.memories ?? [];
  if (recorded.length) return recorded;
  return [{
    id: "now",
    at: state.profile.updatedAt,
    title: "Your worldview, now",
    convictions: convictionsOf(state),
    interests: state.profile.interests.map(i => i.name),
    understanding: state.inferred.map(i => `${i.id}: ${Math.round(i.confidence * 100)}% confidence`),
  }];
}

/** One frame, read against the one before it. */
export function diffFrame(frame: MemoryFrame, previous: MemoryFrame | undefined, events: ActivityEvent[]): GraphFrame {
  const before = new Map((previous?.convictions ?? []).map(c => [c.id, c]));
  const rising = new Set((frame.convictions).filter(c => {
    const was = before.get(c.id);
    return was && c.strength - was.strength >= NUDGE;
  }).map(c => c.id));

  const edges: GraphEdge[] = [];
  const nodes: GraphNode[] = frame.convictions.map((conviction, index) => {
    const was = before.get(conviction.id);
    let change: BeliefChange = "steady";
    let parent: string | undefined;

    if (!was) {
      // Arriving beside something already believed is a branch, not a new root.
      const from = (previous?.convictions ?? []).find(c => shares(c.themes, conviction.themes));
      change = from ? "branched" : "appeared";
      if (from) { parent = from.id; edges.push({ id: `branch:${from.id}->${conviction.id}`, from: from.id, to: conviction.id, kind: "branch" }); }
    } else {
      const move = conviction.strength - was.strength;
      const against = move <= -RECOIL
        ? frame.convictions.find(c => c.id !== conviction.id && rising.has(c.id) && shares(c.themes, conviction.themes))
        : undefined;
      if (against) { change = "contradicted"; edges.push({ id: `against:${against.id}->${conviction.id}`, from: against.id, to: conviction.id, kind: "contradiction" }); }
      else if (move >= NUDGE) change = "strengthened";
      else if (move <= -NUDGE) change = "faded";
    }
    return { id: conviction.id, text: conviction.text, origin: conviction.origin, strength: conviction.strength, themes: conviction.themes, change, parent, ...place(conviction, index) };
  });

  // What was let go is still drawn, going dark, so the loss is visible.
  const kept = new Set(frame.convictions.map(c => c.id));
  for (const [id, conviction] of before) {
    if (kept.has(id)) continue;
    nodes.push({ id, text: conviction.text, origin: conviction.origin, strength: 0, themes: conviction.themes, change: "released", ...place({ ...conviction, strength: 0 }, nodes.length) });
  }

  // Kinship: beliefs that share a theme are drawn as connected.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].change === "released" || nodes[j].change === "released") continue;
      if (nodes[j].parent === nodes[i].id || nodes[i].parent === nodes[j].id) continue;
      if (shares(nodes[i].themes, nodes[j].themes)) edges.push({ id: `kin:${nodes[i].id}:${nodes[j].id}`, from: nodes[i].id, to: nodes[j].id, kind: "kin" });
    }
  }

  // Only what happened in this step, so the graph shows a period rather than a pile.
  const opened = previous ? Date.parse(previous.at) : 0;
  const closed = Date.parse(frame.at);
  const satellites = events.flatMap<Satellite>(event => {
    const at = Date.parse(event.at);
    if (!(at > opened && at <= closed)) return [];
    const themes = themesOfEvent(event);
    const belief = nodes.find(n => n.change !== "released" && shares(n.themes, themes));
    if (!belief) return [];
    return [{ id: event.id, at: event.at, text: event.text, kind: event.kind, belief: belief.id, tradeId: event.tradeId }];
  });

  return { id: frame.id, at: frame.at, title: frame.title, nodes, edges, satellites };
}

/** Every recorded state of mind, in order, each read against the one before. */
export function buildGraph(state: HubState): GraphFrame[] {
  const frames = framesOf(state);
  return frames.map((frame, index) => diffFrame(frame, frames[index - 1], state.events));
}

/** What changed in a frame, in words, for the caption and for anyone reading
 * with their ears rather than their eyes. */
export function summarise(frame: GraphFrame): string {
  const counts = frame.nodes.reduce<Record<string, number>>((all, node) => ({ ...all, [node.change]: (all[node.change] ?? 0) + 1 }), {});
  const said = [
    counts.appeared && `${counts.appeared} new`,
    counts.branched && `${counts.branched} branched`,
    counts.strengthened && `${counts.strengthened} stronger`,
    counts.faded && `${counts.faded} fading`,
    counts.contradicted && `${counts.contradicted} contradicted`,
    counts.released && `${counts.released} let go`,
  ].filter(Boolean);
  return said.length ? said.join(" · ") : "Nothing moved";
}
