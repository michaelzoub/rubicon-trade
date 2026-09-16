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
