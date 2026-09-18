import type { CardAnswer } from "./onboarding-cards";
import { isTopicId, type TopicId } from "./profile-topics";

/**
 * The state adaptive onboarding carries between turns.
 *
 * Two things live here and they are deliberately not the same thing.
 * `evidence` is what the person actually did — appended once, never edited,
 * and the only thing ever sent to the model. `beliefs` is what Jev reads out
 * of that record, recomputed in full every turn rather than folded in
 * incrementally, so one bad reading cannot permanently bend the profile.
 *
 * `source` follows the rule `belief-tree.ts` sets: until the model has
 * answered, nothing here is the model's, and the view must say so.
 */
export type ProbeKind = "choice" | "spectrum" | "map" | "pad" | "chips" | "text";

/** The card kinds plus the one shape a map answer needs. */
export type ProbeAnswer = CardAnswer | { kind: "map"; regions: string[] };

export type Evidence = {
  /** The probe's id, which is also what keeps a topic from being asked twice. */
  id: string;
  at: string;
  kind: ProbeKind;
  /** What we asked, verbatim. Jev reads the question as well as the answer. */
  prompt: string;
  topics: TopicId[];
  answer: ProbeAnswer;
};

export type Belief = {
  topic: TopicId;
  /** 0–1. How far toward holding this claim the evidence puts them. */
  p: number;
  /** 0–1. Jev's confidence in that reading. */
  certainty: number;
};

export type ProfileModel = {
  version: 1;
  evidence: Evidence[];
  beliefs: Belief[];
  asked: string[];
  /** Probes answered, excluding the two foundation scenes. */
  turn: number;
  source: "jev" | "pending";
};

/** A long run should not grow an unbounded payload, and Jev's context is 32k. */
export const MAX_EVIDENCE = 32;
const MAX_PROMPT = 300;
const KINDS: ProbeKind[] = ["choice", "spectrum", "map", "pad", "chips", "text"];
const ANSWER_KINDS = ["scale", "binary", "pad", "chips", "text", "map"];

export const newProfileModel = (): ProfileModel =>
  ({ version: 1, evidence: [], beliefs: [], asked: [], turn: 0, source: "pending" });

/** Appends an answer. Beliefs are untouched: recording what someone did is not
 * the same act as deciding what it means. */
export function recordEvidence(model: ProfileModel, entry: Evidence): ProfileModel {
  return {
    ...model,
    evidence: [...model.evidence, entry].slice(-MAX_EVIDENCE),
    asked: model.asked.includes(entry.id) ? model.asked : [...model.asked, entry.id],
    turn: model.turn + 1,
  };
}

const unit = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

function readEvidence(raw: unknown): Evidence | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const kind = KINDS.find(k => k === e.kind);
  const answer = e.answer as { kind?: unknown } | null;
  if (!kind || typeof e.id !== "string" || typeof e.at !== "string" || typeof e.prompt !== "string") return null;
  if (!answer || typeof answer !== "object" || !ANSWER_KINDS.includes(answer.kind as string)) return null;
  const topics = Array.isArray(e.topics) ? e.topics.filter(isTopicId) : [];
  if (!topics.length || topics.length !== (e.topics as unknown[]).length) return null;
  return { id: e.id.slice(0, 64), at: e.at.slice(0, 40), kind, prompt: e.prompt.slice(0, MAX_PROMPT), topics, answer: answer as ProbeAnswer };
}

/** localStorage is untrusted input. A belief about a topic we retired, or a
 * probability that is not a number, is dropped rather than repaired. */
export function readProfileModel(raw: unknown): ProfileModel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) return undefined;
  const beliefs: Belief[] = (Array.isArray(m.beliefs) ? m.beliefs : []).flatMap((b: unknown) => {
    if (!b || typeof b !== "object") return [];
    const { topic, p, certainty } = b as Record<string, unknown>;
    const value = unit(p), sure = unit(certainty);
    return isTopicId(topic) && value !== null && sure !== null ? [{ topic, p: value, certainty: sure }] : [];
  });
  const evidence = (Array.isArray(m.evidence) ? m.evidence : []).map(readEvidence).filter((e): e is Evidence => !!e).slice(-MAX_EVIDENCE);
  const turn = typeof m.turn === "number" && Number.isFinite(m.turn) && m.turn >= 0 ? Math.min(99, Math.floor(m.turn)) : 0;
  return {
    version: 1, beliefs, evidence, turn,
    asked: Array.isArray(m.asked) ? [...new Set(m.asked.filter((id): id is string => typeof id === "string").map(id => id.slice(0, 64)))].slice(0, 64) : [],
    source: m.source === "jev" ? "jev" : "pending",
  };
}
