/**
 * What the agent is doing, and where it goes next. Kept away from the DOM so
 * the behaviour can be reasoned about and tested on its own; the component
 * supplies rectangles and this decides.
 */
import type { Expression } from "./face";

export type AgentState = Extract<Expression, "idle" | "observing" | "thinking" | "discovering" | "wanting" | "interacting">;

export type AgentSituation = {
  /** The thought surface is open. */
  open: boolean;
  /** A request is in flight. */
  busy: boolean;
  /** Words are arriving right now. */
  streaming: boolean;
  /** A trade cannot move until the person acts. */
  waiting: boolean;
  /** An unread discovery is being offered. */
  discovery: boolean;
  /** The person is reading something the agent can speak to. */
  attending: boolean;
  /** The agent's understanding changed in the last few seconds. */
  reflecting: boolean;
};

/**
 * One state at a time, most demanding first. Talking with the person outranks
 * everything; after that, a decision that is blocked on them outranks the
 * agent's own work, and idle is only what is left when nothing is happening.
 */
export function agentState(situation: AgentSituation): AgentState {
  if (situation.open) return "interacting";
  if (situation.waiting) return "wanting";
  if (situation.busy) return situation.streaming ? "interacting" : "thinking";
  if (situation.discovery) return "discovering";
  if (situation.attending) return "observing";
  if (situation.reflecting) return "observing";
  return "idle";
}

/** What each state says, for the caption and the button's accessible name. */
export const AGENT_LABEL: Record<AgentState, string> = {
  idle: "Here when you need me",
  observing: "Taking this in",
  thinking: "Looking into it",
  discovering: "Found something",
  wanting: "A decision needs you",
  interacting: "With you",
};

/** Travel is slow, and slower again while the person is writing. */
export function travelSeconds(distance: number, state: AgentState, composing: boolean): number {
  const base = state === "discovering" ? 3.2 : state === "wanting" ? 4 : 6;
  const span = Math.min(8, distance / 180);
  return (base + span) * (composing ? 1.7 : 1);
}

/** How long it rests before moving again. Curiosity shortens it; company ends it. */
export function dwellSeconds(state: AgentState, roll: number): number {
  if (state === "interacting" || state === "wanting") return Infinity;
  const floor = state === "discovering" ? 2 : 4;
  return floor + roll * 6;
}

export type Candidate = { id: string; x: number; y: number; weight: number };

/**
 * Weighted choice, avoiding wherever it already is so a wander always goes
 * somewhere. `roll` is 0–1 from the caller, which keeps this deterministic.
 */
export function chooseRegion(candidates: readonly Candidate[], roll: number, currentId?: string): Candidate | null {
  const options = candidates.filter(c => c.weight > 0 && c.id !== currentId);
  const pool = options.length ? options : candidates.filter(c => c.weight > 0);
  if (!pool.length) return null;
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let cursor = Math.min(0.999999, Math.max(0, roll)) * total;
  for (const candidate of pool) {
    cursor -= candidate.weight;
    if (cursor < 0) return candidate;
  }
  return pool[pool.length - 1];
}

/**
 * A curved way there. The agent bows off the straight line so it reads as
 * something moving through space rather than a value being interpolated.
 */
export function arc(from: { x: number; y: number }, to: { x: number; y: number }, bow = 0.22) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const midpoint = { x: from.x + dx / 2, y: from.y + dy / 2 };
  return [from, { x: midpoint.x - dy * bow, y: midpoint.y + dx * bow }, to];
}

/**
 * Keep to the margins. The agent lives beside what a person is reading, not
 * over it, so a destination inside the content column is pushed into whichever
 * gutter is nearer — and only when that gutter is actually wide enough to
 * stand in. On a narrow screen there are no margins, and it stays where it is.
 */
export function keepToGutter(x: number, content: { left: number; right: number }, viewport: number, body: number): number {
  const margin = 12;
  const left = { from: margin, to: content.left - body - margin };
  const right = { from: content.right + margin, to: viewport - body - margin };
  const fits = (lane: { from: number; to: number }) => lane.to >= lane.from;
  if (x + body <= content.left || x >= content.right) return x;
  const nearer = Math.abs(x - content.left) <= Math.abs(x - content.right) ? [left, right] : [right, left];
  for (const lane of nearer) if (fits(lane)) return Math.min(Math.max(x, lane.from), lane.to);
  return x;
}

/** Which way a journey should bow: always away from the middle of the screen,
 * so the agent rounds the content rather than cutting through it. */
export const bowAway = (from: { x: number }, to: { x: number }, centre: number, bow = 0.22) =>
  ((from.x + to.x) / 2 < centre ? -1 : 1) * Math.abs(bow);

/**
 * A point along the arc. Quadratic through the bowed control point, evaluated
 * directly rather than handed to a plugin, so the journey is something we can
 * reason about and test rather than something that either happens or quietly
 * does not.
 */
export function along(path: readonly { x: number; y: number }[], t: number): { x: number; y: number } {
  const [start, control, end] = path;
  const u = Math.min(1, Math.max(0, t)), v = 1 - u;
  return {
    x: v * v * start.x + 2 * v * u * control.x + u * u * end.x,
    y: v * v * start.y + 2 * v * u * control.y + u * u * end.y,
  };
}
