"use client";

import { getAccessToken } from "@privy-io/react-auth";
import { readCard, readPredictionDeck, type Card, type NextCard } from "@/lib/socialtrading/onboarding-cards";

export type CardRequest = { confidence: number | null; knowledge: number | null; priors: { text: string; direction: string; category: string; confidence?: number; years?: number }[]; ownBelief: string; asked: string[]; kinds: string[]; intent?: "swipe" | "card" | "deck"; focusCategory?: string };
export type CardFetcher = (input: CardRequest, signal?: AbortSignal) => Promise<NextCard>;
export type DeckFetcher = (input: { knowledge: number | null; confidence: number | null }, signal?: AbortSignal) => Promise<Card[]>;

async function onboardingHeaders() {
  let token: string | null = null;
  try { token = await getAccessToken(); } catch { token = null; }
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : { "x-onboarding-preview": "1" }) };
}

/** Onboarding runs before the workspace exists, so there is no hub client to
 * borrow. A signed-in run sends its bearer token; `/preview` has no session at
 * all and sends the preview header, which the route honours only on a
 * non-production build. */
export const fetchNextCard: CardFetcher = async (input, signal) => {
  const response = await fetch("/api/trade/onboarding", {
    method: "POST", signal, headers: await onboardingHeaders(),
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as { done?: boolean; card?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? "The next question could not be written.");
  if (body.done) return { done: true };
  const card: Card | null = readCard(body.card);
  if (!card) throw new Error("The next question could not be written.");
  return { done: false, card };
};

/** One call for the whole seven-domain pack, so a swipe cannot change the next
 * swipe — only the profile, and the questions after the deck. */
export const fetchPredictionDeck: DeckFetcher = async (input, signal) => {
  const response = await fetch("/api/trade/onboarding", {
    method: "POST", signal, headers: await onboardingHeaders(),
    body: JSON.stringify({ intent: "deck", knowledge: input.knowledge, confidence: input.confidence }),
  });
  const body = await response.json().catch(() => ({})) as { predictions?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? "The next questions could not be written.");
  const cards = readPredictionDeck(body.predictions);
  if (!cards) throw new Error("The next questions could not be written.");
  return cards;
};
