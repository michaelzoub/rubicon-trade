import { CATEGORIES, CONFIDENCE, EXPERIENCE, PREDICTION_COUNT, predictions } from "./onboarding";

export type VoiceLevel = 1 | 2 | 3 | 4;
export type Prior = { text: string; direction: string; category: string; confidence?: number; years?: number };
export type CardIntent = "swipe" | "card" | "deck";
export type NextCardInput = {
  confidence: number | null;
  knowledge: number | null;
  priors: Prior[];
  ownBelief: string;
  asked: string[];
  kinds: string[];
  intent?: CardIntent;
  focusCategory?: string;
};

/** Stored answers are 0–3; the prompt and the UI both speak in levels 1–4. */
export function storedToVoice(index: number | null): VoiceLevel | null {
  if (index === null || !Number.isInteger(index) || index < 0 || index > 3) return null;
  return (index + 1) as VoiceLevel;
}

/** How to write a statement for each investing-knowledge level. */
export const KNOWLEDGE_VOICE: Record<VoiceLevel, string> = {
  1: "Knowledge 1/4 — easy directional bets. Everyday language. Each statement names a winner, a loser, a pace, or a tradeoff so a reasonable person could say no. Never 'X will be important'.",
  2: "Knowledge 2/4 — real-world adoption with a cost. The same areas, with a consequence someone could reject. Still concrete. No financial expertise required.",
  3: "Knowledge 3/4 — second-order effects. More thoughtful, without requiring financial expertise. What the first change causes next — pick a side between two real outcomes.",
  4: "Knowledge 4/4 — nuanced or opposing views. Test a sharper conviction, still in normal language. A tension between two real forces, not a textbook.",
};

/** How hard the statement should push, given how settled their views feel. */
export const CONVICTION_VOICE: Record<VoiceLevel, string> = {
  1: "Conviction 1/4 — exploring. Tentative. Use 'could' or 'might'. A possibility they can try on, not a claim they must defend.",
  2: "Conviction 2/4 — a few hunches. Directional. State a likely change without forcing a bet.",
  3: "Conviction 3/4 — some things feel clear. A firm, specific change they can agree or disagree with.",
  4: "Conviction 4/4 — they know what they believe. A decisive, take-a-side statement. No hedging. Make the disagreement costly.",
};

export function deckSystem() {
  return `You write a set of onboarding predictions for Rubicon, an investing agent.
The person is describing how they think the world will change.

Return ONLY a JSON object, no prose and no code fence:
{"predictions":[{"category":"Technology","statement":"..."}]}

The "predictions" array MUST contain exactly ${PREDICTION_COUNT} objects, one for each of these categories, in any order:
${CATEGORIES.join(" | ")}

Each "statement" is a single forward-looking sentence they can agree with, disagree with, or be unsure about.
- Under 140 characters.
- Declarative. Not a question. No leading "Will" or "Do you think".
- Normal language. No tickers, company names, or funds.
- Exactly one statement per category. Never skip a domain.
- At most ONE statement may mention AI. The rest must be about their own domain.
- Do not write two statements about the same subject in different words.
- Force a real side: a winner, a loser, a pace, or a tradeoff. A claim almost everyone would accept is a failure.

Match the knowledge level in the user message. A beginner gets an easy directional bet. An experienced person gets a sharper opposing view. A mismatch of depth is a failure.`;
}

export function swipeSystem() {
  return `You write one swipe card at a time for Rubicon, an investing agent.
The person is describing how they think the world will change, so their agent can start from their view.

Return ONLY a JSON object, no prose and no code fence:
{"id":"c3","kind":"binary","title":"...","lead":"...","category":"..."}

kind MUST be "binary". Put a single forward-looking statement in "title". They will swipe: agree, disagree, or unsure.
"lead" is one short sentence of context under 240 characters. Never a second question.
category must be exactly one of: ${CATEGORIES.join(" | ")}
"title" is under 140 characters.

This card covers one domain of the world. Other cards cover the other domains. Do not follow on from a previous swipe; do not mention what they just answered.
At most one card in a run may mention AI.

Rules:
- Never re-ask something they have been shown, and never restate an earlier question in different words.
- Do not mention specific tickers, companies, or funds.
- Match the knowledge-level voice below. A mismatch of depth is a failure.`;
}

export function cardSystem() {
  return `You write one onboarding card at a time for Rubicon, an investing agent.
The person is describing how they think the world will change, so their agent can start from their view.

Return ONLY a JSON object, no prose and no code fence:
{"id":"c3","kind":"pad","title":"...","lead":"...","category":"...","options":["..."]}

kind must be one of:
- "binary" — a single forward-looking statement they agree with, disagree with, or are unsure about. Put the statement in "title".
- "pad" — they place one dot for how sure they are and how far ahead they are looking. Use this at most ONCE in the whole run, to deepen a view they already took a side on. It captures confidence AND timing together, so never follow it with another question about either.
- "chips" — a multiple choice of 2 to 12 short "options" they can select several of.
- "scale" — exactly 4 "options", ordered low to high, one axis.
- "text" — an open answer. Use at most once.

category must be exactly one of: ${CATEGORIES.join(" | ")}

Rules:
- Ask what their previous answers leave genuinely open. Never re-ask something they have answered, and never restate an earlier question in different words.
- Each card must move to a different aspect than the one before it. Two cards in a row about the same subject is a failure.
- Follow the strongest signal: if they took a firm side, go deeper on it rather than changing subject.
- "title" is the question or statement, under 140 characters, in plain language with no jargon.
- "lead" is one short sentence of context under 240 characters. Never a second question.
- Do not mention specific tickers, companies, or funds.
- Match their stated experience level. A beginner gets concrete wording, not abstractions.`;
}

function voiceBlock(knowledge: number | null, confidence: number | null) {
  const k = storedToVoice(knowledge);
  const c = storedToVoice(confidence);
  return [
    k ? KNOWLEDGE_VOICE[k] : "Knowledge unknown — write as Knowledge 2/4.",
    c ? CONVICTION_VOICE[c] : null,
    k ? `Write at knowledge ${k}/4.` : null,
  ].filter(Boolean).join("\n");
}

export function deckPrompt(input: { knowledge: number | null; confidence: number | null }) {
  const knowledgeLabel = input.knowledge !== null ? EXPERIENCE[input.knowledge] : null;
  const examples = predictions(input.knowledge ?? 1);
  return [
    voiceBlock(input.knowledge, input.confidence),
    knowledgeLabel ? `Investing experience: ${knowledgeLabel}.` : null,
    `Match this depth. You may rephrase, but keep each domain's idea and difficulty:\n${examples.map(p => `- [${p.category}] ${p.text}`).join("\n")}`,
    `Write all ${PREDICTION_COUNT} predictions now. One per category. At most one may mention AI.`,
  ].filter(Boolean).join("\n\n");
}

export function nextCardPrompt(input: NextCardInput) {
  if (input.intent === "deck") return deckPrompt(input);
  const knowledgeLabel = input.knowledge !== null ? EXPERIENCE[input.knowledge] : null;
  const convictionLabel = input.confidence !== null ? CONFIDENCE[input.confidence] : null;
  const focus = input.focusCategory && CATEGORIES.includes(input.focusCategory) ? input.focusCategory : null;
  const examples = predictions(input.knowledge ?? 1);
  const lines = [
    voiceBlock(input.knowledge, input.confidence),
    convictionLabel ? `How settled their views feel: ${convictionLabel}.` : null,
    knowledgeLabel ? `Investing experience: ${knowledgeLabel}.` : null,
    `Depth to match:\n${examples.map(p => `- [${p.category}] ${p.text}`).join("\n")}`,
    input.asked.length ? `Already shown, do not repeat or rephrase: ${input.asked.join(" | ")}` : null,
    input.intent !== "swipe" && input.kinds.includes("pad")
      ? "A pad card has already been used, and their confidence and time horizon are recorded. Do not use kind \"pad\" again, and do not ask about certainty or timing."
      : null,
    focus ? `This card MUST use category "${focus}". The statement is about that domain only.` : null,
    input.intent === "swipe"
      ? `Write swipe ${input.asked.length + 1} of ${PREDICTION_COUNT}. Do not follow on from a previous swipe.`
      : `Write card ${input.asked.length + 1} of ${PREDICTION_COUNT}.`,
  ];
  return lines.filter(Boolean).join("\n\n");
}
