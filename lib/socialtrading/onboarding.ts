export const CONFIDENCE = ["I’m here to explore", "I have a few hunches", "Some things feel clear", "I know what I believe"];
export const EXPERIENCE = ["Unknown grounds", "I know the basics", "I am comfortable exploring", "Experienced"];
export const EXPERIENCE_NOTES = ["I’m new or have barely started.", "I understand stocks, ETFs or crypto.", "I can research and compare investments myself.", "I manage my own portfolio and know what I’m looking at."];
export const DISLIKES = ["Non-ESG companies", "ESG companies", "Fossil fuels", "Defence and weapons", "Tobacco", "Gambling", "Memecoins", "Highly speculative investments", "Real estate", "Commodities", "Short-term trading"];
export const CATEGORIES = ["Technology", "Energy", "Money and crypto", "Health and demographics", "Government and geopolitics", "Climate and infrastructure", "Society and work"];
/** One word per domain, so a view can be picked as an object rather than read
 * as a sentence. Positional with CATEGORIES. */
export const KEYWORDS = ["Robots", "Power", "Crypto", "Longevity", "Sovereignty", "Climate", "AI"];
// One question per domain. Knowledge changes depth, never domain coverage.
const QUESTIONS = [
  ["Robots become common in physical work.", "Electricity becomes much more important.", "Crypto becomes useful beyond trading.", "Biotechnology helps people live healthier for longer.", "Countries produce more essential goods at home.", "Climate change forces major infrastructure upgrades.", "AI becomes part of most people’s jobs within five years."],
  ["Robots take over repetitive work in factories and warehouses.", "Electricity demand grows faster than power systems can adapt.", "Stablecoins become a normal way to move money.", "Ageing populations make healthcare much more important.", "Governments spend more on defence and domestic manufacturing.", "Climate adaptation becomes as important as reducing emissions.", "Most companies use AI in their everyday operations."],
  ["Robotics creates more value in industrial work than in consumer products.", "Power availability becomes a bigger constraint on AI than computing chips.", "Crypto succeeds mainly through infrastructure people barely notice.", "Ageing populations reshape labour markets as much as healthcare.", "Energy security matters more to governments than cheap energy.", "Climate adaptation grows faster than climate-prevention spending.", "AI transforms traditional industries more than it creates new ones."],
  ["Robotics changes the physical economy more than AI changes office work.", "Electricity infrastructure becomes a longer-lasting trend than the current AI boom.", "Digital finance adopts blockchain even if most cryptocurrencies disappear.", "Healthcare innovation accelerates, but regulation prevents rapid adoption.", "Deglobalization proves more expensive and slower than governments expect.", "Climate adaptation attracts more investment than preventing climate change.", "The biggest AI winners will be companies adopting it, not companies selling AI products."],
];
export type PredictionResponse = { id: string; category: string; text: string; direction: "yes" | "no" | "unsure"; confidence?: number; years?: number };
export type OnboardingAnswers = { version: 1; scene: number; confidence: number | null; responses: PredictionResponse[]; strongest: string[]; dislikes: string[]; openToEverything: boolean; ownBelief: string };
export const newOnboarding = (): OnboardingAnswers => ({ version: 1, scene: 0, confidence: null, responses: [], strongest: [], dislikes: [], openToEverything: false, ownBelief: "" });
export function predictions(knowledge: number) {
  const level = Math.max(0, Math.min(3, knowledge));
  return QUESTIONS[level].map((text, i) => ({ id: `${level}-${i}`, category: CATEGORIES[i], text }));
}
export function readOnboarding(raw: unknown): OnboardingAnswers | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as OnboardingAnswers;
  if (r.version !== 1) return undefined;
  const bounded = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const responses = Array.isArray(r.responses) ? r.responses.filter(p => p && typeof p.id === "string" && typeof p.text === "string" && p.text.length <= 300 && CATEGORIES.includes(p.category) && ["yes", "no", "unsure"].includes(p.direction)).slice(0, 7).map(p => ({ id: p.id, text: p.text, category: p.category, direction: p.direction, ...(bounded(p.confidence, 50, 99) ? { confidence: p.confidence } : {}), ...(bounded(p.years, 3, 11) ? { years: p.years } : {}) })) : [];
  return { version: 1, scene: Number.isInteger(r.scene) && bounded(r.scene, 0, 8) ? r.scene : 0, confidence: Number.isInteger(r.confidence) && bounded(r.confidence, 0, 3) ? r.confidence : null, responses, strongest: Array.isArray(r.strongest) ? [...new Set(r.strongest.filter(id => responses.some(p => p.id === id && p.direction !== "unsure")))].slice(0, 2) : [], dislikes: Array.isArray(r.dislikes) ? DISLIKES.filter(d => r.dislikes.includes(d)) : [], openToEverything: r.openToEverything === true && !r.dislikes?.length, ownBelief: typeof r.ownBelief === "string" ? r.ownBelief.slice(0, 300) : "" };
}
// Scenes: 0 clarity · 1 knowledge · 2 the AI chart · 3 the world map ·
// 4 the branching deck · 5 strongest views · 6 conviction · 7 dislikes · 8 rules.
export const SCENE = { clarity: 0, knowledge: 1, horizon: 2, geography: 3, deck: 4, strongest: 5, chart: 6, dislikes: 7, rules: 8 } as const;

/** The index of the AI question inside a level's deck. Everybody answers it
 * first, on the chart, because how fast and how far AI goes is the assumption
 * every other question in the deck ends up leaning on. */
const AI = 6;
export const basePrediction = (knowledge: number) => predictions(knowledge)[AI];
/** True for the opening AI question at any depth. It already carries its
 * conviction from the chart, so the later conviction scene must not ask again —
 * and must not vanish mid-gesture the moment a dot is placed. */
export const isBaseId = (id: string) => id.endsWith(`-${AI}`);

/** Where a decided view leads next. Agreeing follows the consequence of the
 * belief; anything else crosses to the tension it leaves behind. A domain is
 * never asked twice, and nobody is asked all seven. */
const FOLLOW: Record<string, [string, string]> = {
  "Society and work": ["Technology", "Health and demographics"],
  "Technology": ["Energy", "Society and work"],
  "Energy": ["Climate and infrastructure", "Government and geopolitics"],
  "Government and geopolitics": ["Energy", "Money and crypto"],
  "Money and crypto": ["Government and geopolitics", "Technology"],
  "Health and demographics": ["Society and work", "Climate and infrastructure"],
  "Climate and infrastructure": ["Energy", "Health and demographics"],
};
/** Follow-ups after the two base questions. Four is enough to reach a corner of
 * the map that the base answers did not already give away. */
export const DECK_SIZE = 4;

/** The next question this particular run has earned, or nothing when the deck
 * has said what it needs to. Pure, so the scene order can look one step ahead. */
export function nextPrediction(a: OnboardingAnswers, knowledge: number) {
  const deck = predictions(knowledge);
  const asked = new Set(a.responses.map(r => r.category));
  if (asked.size > DECK_SIZE) return undefined;
  const last = a.responses.at(-1);
  const wanted = last ? FOLLOW[last.category]?.[last.direction === "yes" ? 0 : 1] : undefined;
  return (wanted && !asked.has(wanted) ? deck.find(p => p.category === wanted) : undefined)
    ?? deck.find(p => !asked.has(p.category));
}
/** How many follow-ups have been answered, ignoring the base question. */
export const deckProgress = (a: OnboardingAnswers) => Math.max(0, a.responses.length - 1);

export function sceneOrder(a: OnboardingAnswers) {
  // Conviction is only asked for a chosen view that did not already get it on
  // the opening chart, so nobody places the same dot twice. It is keyed off the
  // view, not off the answer, so placing the dot cannot remove the scene you
  // are standing on.
  const needsChart = a.strongest.some(id => !isBaseId(id));
  return [SCENE.clarity, SCENE.knowledge, SCENE.horizon, SCENE.geography, SCENE.deck, SCENE.strongest, ...(needsChart ? [SCENE.chart] : []), SCENE.dislikes, SCENE.rules];
}
/** A stored scene may no longer be reachable after answers change; land on the nearest earlier one. */
export function resolveScene(a: OnboardingAnswers) {
  const order = sceneOrder(a);
  return order.filter(s => s <= a.scene).at(-1) ?? order[0];
}
export function onboardingThesis(a: OnboardingAnswers) {
  const selected = a.responses.filter(r => a.strongest.includes(r.id));
  return [...selected.map(r => `${r.direction === "yes" ? "I expect" : "I do not expect"}: ${r.text}${r.confidence ? ` Confidence in this view: ${r.confidence}%.` : ""}${r.years ? ` Horizon: ${r.years === 11 ? "more than ten" : r.years} years.` : ""}`), a.ownBelief.trim()].filter(Boolean).join("\n") || "I’m exploring possible futures and have not settled on a strong conviction yet.";
}
