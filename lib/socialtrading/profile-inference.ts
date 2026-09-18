import "server-only";
import { askJev } from "./jev";
import type { JevQuestion } from "./jev-types";
import { PROBE_TOPICS } from "./profile-topics";
import type { Belief, Evidence } from "./profile-model";

/**
 * What the evidence says, read by Jev.
 *
 * One question per topic, all in one batch — the catalog is fifteen and Jev's
 * batch is forty, so a turn is a single round trip. Each is a `score` rather
 * than a `noul`: a noul returns a bare probability and carries no confidence,
 * and confidence is exactly what the sequencer needs in order to know what not
 * to ask next.
 *
 * The state is the raw evidence and the two foundations. The previous beliefs
 * are deliberately not sent, so every turn is a fresh reading of the record
 * rather than a drift away from the last one.
 */

export const BELIEF_LEVELS = [
  "The evidence points away from this — they would reject it",
  "They lean against it",
  "Nothing in the evidence says either way",
  "They lean toward it",
  "The evidence points squarely at this — they hold it",
];

const INSTRUCTION = "Read only what this person actually answered. Where does the evidence put them on this claim?";

export function beliefQuestions(): Record<string, JevQuestion> {
  return Object.fromEntries(PROBE_TOPICS.map(topic => [
    topic.id,
    { type: "score", instructions: `${INSTRUCTION}\n\nClaim: ${topic.claim}`, criteria: BELIEF_LEVELS } satisfies JevQuestion,
  ]));
}

export type Foundations = { confidence: number | null; knowledge: number | null };

/** `null` means Jev could not be reached at all. The caller keeps the beliefs
 * it already had and marks the model `pending` — a reading nobody made is not
 * a reading of zero. */
export async function inferBeliefs(evidence: Evidence[], foundations: Foundations, signal?: AbortSignal): Promise<Belief[] | null> {
  const answers = await askJev({ foundations, evidence }, beliefQuestions(), signal);
  if (!answers) return null;
  const top = BELIEF_LEVELS.length - 1;
  const beliefs: Belief[] = [];
  for (const topic of PROBE_TOPICS) {
    const answer = answers[topic.id];
    if (!answer || answer.type !== "score") continue;
    beliefs.push({ topic: topic.id, p: answer.score / top, certainty: answer.confidence });
  }
  return beliefs;
}
