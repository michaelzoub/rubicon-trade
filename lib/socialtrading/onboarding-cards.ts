import { CATEGORIES, type OnboardingAnswers } from "./onboarding";

/** The contract both onboarding arms speak. The tree builds these from its own
 * fixed scenes; the inference arm receives them from the model. Whoever renders
 * a card only needs `kind` — it never asks which arm produced it. */
export const CARD_KINDS = ["scale", "binary", "pad", "chips", "text"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export type Card = {
  id: string;
  kind: CardKind;
  title: string;
  lead: string;
  /** One of CATEGORIES, so an answer lands in the same domain space as the tree's. */
  category: string;
  /** `scale` needs exactly 4; `chips` needs 2–12. Unused by the other kinds. */
  options?: string[];
};

export type CardAnswer =
  | { kind: "scale"; value: number }
  | { kind: "binary"; direction: "yes" | "no" | "unsure" }
  | { kind: "pad"; confidence: number; years: number }
  | { kind: "chips"; values: string[] }
  | { kind: "text"; value: string };

const string = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max ? value.trim() : null;

/** The model's output is untrusted input. A card that is not exactly right is
 * dropped rather than repaired, and the caller falls back to the tree — a
 * half-valid card would ask a question nobody can answer. */
export function readCard(raw: unknown): Card | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const kind = CARD_KINDS.find(k => k === c.kind);
  const id = string(c.id, 64), title = string(c.title, 140), lead = string(c.lead, 240);
  const category = CATEGORIES.find(name => name === c.category);
  if (!kind || !id || !title || !lead || !category) return null;
  const options = Array.isArray(c.options) ? c.options.map(o => string(o, 80)).filter((o): o is string => !!o) : [];
  if (kind === "scale" && options.length !== 4) return null;
  if (kind === "chips" && (options.length < 2 || options.length > 12)) return null;
  return { id, kind, title, lead, category, ...(kind === "scale" || kind === "chips" ? { options } : {}) };
}

/** What the endpoint returns: the next card, or the end of the run. */
export type NextCard = { done: true } | { done: false; card: Card };

const DECK_LEAD = "Take a side.";

/** A generated seven-domain pack. Every category must be present exactly once
 * or the pack is dropped and the caller uses the knowledge-level bank. */
export function readPredictionDeck(raw: unknown): Card[] | null {
  const list = Array.isArray(raw) ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { predictions?: unknown }).predictions)
      ? (raw as { predictions: unknown[] }).predictions
      : null;
  if (!list) return null;
  const byCategory = new Map<string, Card>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = string(row.statement ?? row.title, 140);
    const category = CATEGORIES.find(name => name === row.category);
    if (!title || !category || byCategory.has(category)) continue;
    const card = readCard({ id: `deck-${category}`, kind: "binary", title, lead: string(row.lead, 240) ?? DECK_LEAD, category });
    if (card) byCategory.set(category, card);
  }
  if (byCategory.size !== CATEGORIES.length) return null;
  return CATEGORIES.map(category => byCategory.get(category)!);
}

const appended = (belief: string, line: string) => [belief.trim(), line].filter(Boolean).join(" ").slice(0, 300);

/** Folds one answered card into the same answer shape the tree produces, so
 * both arms end at `onboardingThesis` and `suggestedThemes` and their outputs
 * can be read against each other. A generated card that takes a side becomes a
 * response; anything softer becomes part of the person's own words. */
export function applyAnswer(a: OnboardingAnswers, card: Card, answer: CardAnswer): OnboardingAnswers {
  if (answer.kind === "binary") {
    const responses = [...a.responses.filter(r => r.id !== card.id), { id: card.id, category: card.category, text: card.title, direction: answer.direction }];
    // The first two decided views carry the thesis, exactly as the tree's shortlist does.
    const strongest = answer.direction === "unsure" ? a.strongest.filter(id => id !== card.id)
      : a.strongest.includes(card.id) || a.strongest.length >= 2 ? a.strongest : [...a.strongest, card.id];
    return { ...a, responses, strongest };
  }
  if (answer.kind === "pad") {
    // Deepens the most recent view that has no depth yet; otherwise stands alone.
    const target = [...a.responses].reverse().find(r => a.strongest.includes(r.id) && r.confidence === undefined)
      ?? [...a.responses].reverse().find(r => a.strongest.includes(r.id));
    if (!target) {
      const response = { id: card.id, category: card.category, text: card.title, direction: "yes" as const, confidence: answer.confidence, years: answer.years };
      return { ...a, responses: [...a.responses.filter(r => r.id !== card.id), response], strongest: a.strongest.length >= 2 ? a.strongest : [...a.strongest, card.id] };
    }
    return { ...a, responses: a.responses.map(r => r.id === target.id ? { ...r, confidence: answer.confidence, years: answer.years } : r) };
  }
  if (answer.kind === "chips") return { ...a, ownBelief: appended(a.ownBelief, answer.values.length ? `${card.title} ${answer.values.join(", ")}.` : "") };
  if (answer.kind === "scale") return { ...a, ownBelief: appended(a.ownBelief, `${card.title} ${(card.options ?? [])[answer.value] ?? ""}.`) };
  return { ...a, ownBelief: appended(a.ownBelief, answer.value) };
}
