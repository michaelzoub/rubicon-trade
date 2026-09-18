/**
 * The wire shapes of Jev, TypeSafe's System One model. Kept apart from the
 * client in `jev.ts` because that module is `server-only` and these types are
 * read by the browser-safe tree builder on both sides of the request.
 *
 * Jev answers with a probability distribution rather than prose: a Choice
 * returns the winning option plus a probability for every option, a Score
 * returns a position on an ordered set of levels, and both carry a confidence
 * derived from how flat the distribution is. A Noul is a bare probability and
 * carries no confidence of its own.
 */

export type JevQuestion =
  /** Pick one named option. `criteria` maps each option to a description of it. */
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  /** Rate against ordered levels, low end first. Two to ten levels. */
  | { type: "score"; instructions: string; criteria: string[] }
  /** A yes/no probability. `criteria` describes each pole. */
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } };

export type JevChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type JevScoreAnswer = { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };
export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevAnswer = JevChoiceAnswer | JevScoreAnswer | JevNoulAnswer;
export type JevAnswers = Record<string, JevAnswer>;
