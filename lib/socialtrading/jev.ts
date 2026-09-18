import "server-only";
import type { JevAnswer, JevAnswers, JevQuestion } from "./jev-types";
export type { JevAnswer, JevAnswers, JevChoiceAnswer, JevNoulAnswer, JevQuestion, JevScoreAnswer } from "./jev-types";

/**
 * Jev, TypeSafe's System One model, reached through OpenRouter's decisions
 * endpoint. It is not a chat model: `chat/completions` rejects it. You hand it
 * a state and a map of typed questions, and it hands back typed answers with a
 * calibrated probability distribution and a confidence for each.
 *
 * Everything here is deliberately total: a missing key, a dead upstream, a
 * timeout or a reply in a shape we did not expect all return `null`, and the
 * caller falls back to its own arithmetic. A confidence tree that cannot reach
 * the model is still a tree.
 */

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** Overridable so a newer Jev can be rolled out without a deploy of this file. */
export const jevModel = () => process.env.JEV_MODEL?.trim() || "typesafe/jev-1.13";

/**
 * How many questions travel in one request. Jev evaluates questions in
 * parallel, so fanning out is close to free in latency, but the context window
 * is 32k and a runaway worldview should not blow it. Anything longer is split
 * across requests that run concurrently.
 */
const BATCH = 40;
const TIMEOUT_MS = 12_000;

const finite = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const unit = (value: unknown) => Math.min(1, Math.max(0, finite(value, 0)));

/** Probability maps come off the wire as `unknown`; keep only real numbers. */
function distribution(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => typeof v === "number" && Number.isFinite(v)) as [string, number][]);
}

/** One answer, validated against the question that asked for it. An answer of
 * the wrong type, or a Choice naming an option we never offered, is dropped
 * rather than trusted. */
function readAnswer(question: JevQuestion, raw: unknown): JevAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (question.type === "noul") {
    return typeof answer.noul === "number" ? { type: "noul", noul: unit(answer.noul) } : null;
  }
  if (question.type === "choice") {
    const choice = typeof answer.choice === "string" ? answer.choice : null;
    if (!choice || !(choice in question.criteria)) return null;
    return { type: "choice", choice, probabilities: distribution(answer.probabilities), confidence: unit(answer.confidence) };
  }
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) return null;
  const top = Math.max(0, question.criteria.length - 1);
  return {
    type: "score",
    score: Math.min(top, Math.max(0, answer.score)),
    legend: Object.fromEntries(question.criteria.map((level, i) => [String(i), level])),
    probabilities: distribution(answer.probabilities),
    confidence: unit(answer.confidence),
  };
}

async function askBatch(state: unknown, questions: Record<string, JevQuestion>, signal?: AbortSignal): Promise<JevAnswers> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("no key");
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(DECISIONS_URL, {
    method: "POST",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": "https://rubiconpay.xyz", "X-Title": "Rubicon belief tree" },
    body: JSON.stringify({ model: jevModel(), state, questions }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`jev ${response.status} ${detail.slice(0, 200)}`);
  }
  const body = (await response.json()) as { answers?: unknown };
  const answers = body.answers && typeof body.answers === "object" ? (body.answers as Record<string, unknown>) : {};
  const read: JevAnswers = {};
  for (const [id, question] of Object.entries(questions)) {
    const value = readAnswer(question, answers[id]);
    if (value) read[id] = value;
  }
  return read;
}

/**
 * Ask Jev everything at once. Returns whatever it answered — possibly a subset,
 * if one batch failed — or `null` when nothing came back at all, which is the
 * caller's signal to fall back to local arithmetic.
 */
export async function askJev(state: unknown, questions: Record<string, JevQuestion>, signal?: AbortSignal): Promise<JevAnswers | null> {
  const ids = Object.keys(questions);
  if (!ids.length) return {};
  const batches: Record<string, JevQuestion>[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    batches.push(Object.fromEntries(ids.slice(i, i + BATCH).map(id => [id, questions[id]])));
  }
  const settled = await Promise.allSettled(batches.map(batch => askBatch(state, batch, signal)));
  const answers: JevAnswers = {};
  let reached = false;
  for (const result of settled) {
    if (result.status === "fulfilled") { reached = true; Object.assign(answers, result.value); }
    else console.error("[jev]", result.reason instanceof Error ? result.reason.message : result.reason);
  }
  return reached ? answers : null;
}
