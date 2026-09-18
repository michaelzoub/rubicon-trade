import { authenticate, bodyOf, failure, HubError } from "@/lib/socialtrading/server";
import { openRouterModel } from "@/lib/socialtrading/runtime/model";
import { readCard, readPredictionDeck, type Card } from "@/lib/socialtrading/onboarding-cards";
import { CATEGORIES, PREDICTION_COUNT } from "@/lib/socialtrading/onboarding";
import { cardSystem, deckPrompt, deckSystem, nextCardPrompt, swipeSystem, type Prior } from "@/lib/socialtrading/onboarding-voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Onboarding runs before the workspace exists, so there is no HubState to load
 * and no plan to read. The model is pinned to the cheapest tier rather than the
 * caller's plan: this is a short pack of cards, not the agent's reasoning loop. */
const PLAN = "free";

/** Models wrap JSON in prose or a fence often enough to be worth handling. */
function parseJsonObject(content: string): unknown {
  const direct = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const start = direct.indexOf("{"), end = direct.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(direct.slice(start, end + 1)); } catch { return null; }
}

function parseCard(content: string): Card | null {
  try { return readCard(parseJsonObject(content)); } catch { return null; }
}

function parseSwipe(content: string): Card | null {
  const binary = parseCard(content);
  if (binary?.kind === "binary") return binary;
  const raw = parseJsonObject(content);
  if (!raw || typeof raw !== "object") return null;
  return readCard({ ...(raw as Record<string, unknown>), kind: "binary", options: undefined });
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
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "The onboarding model is not configured on this deployment.");

    const knowledge = bounded(body.knowledge, 0, 3);
    const confidence = bounded(body.confidence, 0, 3);

    if (body.intent === "deck") {
      const { content } = await openRouterModel(PLAN).complete({
        messages: [
          { role: "system", content: deckSystem() },
          { role: "user", content: deckPrompt({ knowledge, confidence }) },
        ],
        tools: [], toolChoice: "none", signal: request.signal, maxTokens: 700,
      });
      const cards = readPredictionDeck(parseJsonObject(content));
      if (!cards) throw new HubError(502, "The onboarding model returned an unusable deck.");
      return Response.json({ predictions: cards });
    }

    const asked = Array.isArray(body.asked) ? body.asked.filter((t: unknown): t is string => typeof t === "string").slice(0, PREDICTION_COUNT).map((t: string) => t.slice(0, 200)) : [];
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter((k: unknown): k is string => typeof k === "string").slice(0, PREDICTION_COUNT) : [];
    if (asked.length >= PREDICTION_COUNT) return Response.json({ done: true });

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

    const swipe = body.intent === "swipe";
    const focusCategory = typeof body.focusCategory === "string" && CATEGORIES.includes(body.focusCategory) ? body.focusCategory : undefined;
    const input = { confidence, knowledge, priors, ownBelief: String(body.ownBelief ?? "").slice(0, 300), asked, kinds, ...(swipe ? { intent: "swipe" as const } : {}), ...(focusCategory ? { focusCategory } : {}) };

    const { content } = await openRouterModel(PLAN).complete({
      messages: [
        { role: "system", content: swipe ? swipeSystem() : cardSystem() },
        { role: "user", content: nextCardPrompt(input) },
      ],
      tools: [], toolChoice: "none", signal: request.signal, maxTokens: 320,
    });

    const card = swipe ? parseSwipe(content) : parseCard(content);
    if (!card) throw new HubError(502, "The onboarding model returned an unusable card.");
    const category = focusCategory ?? card.category;
    return Response.json({ done: false, card: { ...card, id: `gen-${asked.length}-${card.id}`, category, ...(swipe ? { kind: "binary" } : {}) } });
  } catch (e) { return failure(e); }
}
