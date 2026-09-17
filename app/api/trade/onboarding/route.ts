import { authenticate, bodyOf, failure, HubError } from "@/lib/socialtrading/server";
import { openRouterModel } from "@/lib/socialtrading/runtime/model";
import { readCard, type Card } from "@/lib/socialtrading/onboarding-cards";
import { CATEGORIES, EXPERIENCE, CONFIDENCE } from "@/lib/socialtrading/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** The inference arm writes at most this many cards of its own. The cap is
 * enforced here, from what the caller says it has already been asked, because a
 * client that keeps asking is exactly what would run up a bill. */
const MAX_GENERATED = 4;

/** Onboarding runs before the workspace exists, so there is no HubState to load
 * and no plan to read. The model is pinned to the cheapest tier rather than the
 * caller's plan: this is four short cards, not the agent's reasoning loop. */
const PLAN = "free";

type Prior = { text: string; direction: string; category: string; confidence?: number; years?: number };

const SYSTEM = `You write one onboarding card at a time for Rubicon, an investing agent.
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

function userPrompt(input: { confidence: number | null; knowledge: number | null; priors: Prior[]; ownBelief: string; asked: string[]; kinds: string[] }) {
  const lines = [
    input.confidence !== null ? `How settled their views feel: ${CONFIDENCE[input.confidence] ?? "unknown"}.` : null,
    input.knowledge !== null ? `Investing experience: ${EXPERIENCE[input.knowledge] ?? "unknown"}.` : null,
    input.priors.length ? `Their answers so far:\n${input.priors.map(p => `- [${p.category}] ${p.direction === "yes" ? "Agrees" : p.direction === "no" ? "Disagrees" : "Unsure"}: ${p.text}${p.confidence ? ` (${p.confidence}% sure, ${p.years} year horizon)` : ""}`).join("\n")}` : "They have not answered anything yet.",
    input.ownBelief ? `In their own words: ${input.ownBelief}` : null,
    input.asked.length ? `Already asked, do not repeat or rephrase: ${input.asked.join(" | ")}` : null,
    input.kinds.includes("pad") ? "A pad card has already been used, and their confidence and time horizon are recorded. Do not use kind \"pad\" again, and do not ask about certainty or timing." : null,
    `Write card ${input.asked.length + 1} of ${MAX_GENERATED}.`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** Models wrap JSON in prose or a fence often enough to be worth handling. */
function parseCard(content: string): Card | null {
  const direct = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = direct.indexOf("{"), end = direct.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return readCard(JSON.parse(direct.slice(start, end + 1))); } catch { return null; }
}

const bounded = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Local preview drives both arms without a session. Gated on a non-production
 * build AND an explicit header, so it cannot be reached on a deployed build
 * even if the header is sent. */
function previewing(request: Request) {
  return process.env.NODE_ENV !== "production" && request.headers.get("x-onboarding-preview") === "1";
}

export async function POST(request: Request) {
  try {
    if (!previewing(request)) await authenticate(request);
    const body = await bodyOf(request);
    const asked = Array.isArray(body.asked) ? body.asked.filter((t: unknown): t is string => typeof t === "string").slice(0, MAX_GENERATED).map((t: string) => t.slice(0, 200)) : [];
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k: unknown): k is string => typeof k === "string").slice(0, MAX_GENERATED) : [];
    if (asked.length >= MAX_GENERATED) return Response.json({ done: true });
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "The onboarding model is not configured on this deployment.");

    const priors: Prior[] = (Array.isArray(body.priors) ? body.priors : []).slice(0, 12)
      .filter((p: unknown): p is Record<string, unknown> => !!p && typeof p === "object")
      .map((p: Record<string, unknown>): Prior => ({
        text: String(p.text ?? "").slice(0, 300),
        direction: ["yes", "no", "unsure"].includes(p.direction as string) ? p.direction as string : "unsure",
        category: CATEGORIES.includes(p.category as string) ? p.category as string : CATEGORIES[0],
        ...(bounded(p.confidence, 50, 99) !== null ? { confidence: p.confidence as number } : {}),
        ...(bounded(p.years, 3, 11) !== null ? { years: p.years as number } : {}),
      }))
      .filter((p: Prior) => p.text);

    const { content } = await openRouterModel(PLAN).complete({
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt({ confidence: bounded(body.confidence, 0, 3), knowledge: bounded(body.knowledge, 0, 3), priors, ownBelief: String(body.ownBelief ?? "").slice(0, 300), asked, kinds }) },
      ],
      // One small JSON object. The agent loop's budget would be 3x what a card needs.
      tools: [], toolChoice: "none", signal: request.signal, maxTokens: 320,
    });

    const card = parseCard(content);
    if (!card) throw new HubError(502, "The onboarding model returned an unusable card.");
    // The model picks its own ids and can repeat them; the position is unique.
    return Response.json({ done: false, card: { ...card, id: `gen-${asked.length}-${card.id}` } });
  } catch (e) { return failure(e); }
}
