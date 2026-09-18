export const CONFIDENCE = ["I’m here to explore", "I have a few hunches", "Some things feel clear", "I know what I believe"];
export const EXPERIENCE = ["New to investing", "Getting started", "Comfortable investing", "Experienced investor"];
export const EXPERIENCE_NOTES = ["I’m new or have barely started.", "I understand stocks, ETFs or crypto.", "I can research and compare investments myself.", "I manage my own portfolio and know what I’m looking at."];
export const DISLIKES = ["Non-ESG companies", "ESG companies", "Fossil fuels", "Defence and weapons", "Tobacco", "Gambling", "Memecoins", "Highly speculative investments", "Real estate", "Commodities", "Short-term trading"];
export const CATEGORIES = ["Technology", "Energy", "Money and crypto", "Health and demographics", "Government and geopolitics", "Climate and infrastructure", "Society and work"];
/** One word per domain, so a view can be picked as an object rather than read
 * as a sentence. Positional with CATEGORIES. */
export const KEYWORDS = ["Robots", "Power", "Crypto", "Longevity", "Sovereignty", "Climate", "AI"];
/** One statement per domain. Knowledge changes depth, never domain coverage:
 * level 1 is an easy directional bet, 2 is real-world adoption with a loser,
 * 3 is a second-order effect, 4 is a sharper opposing view — still in normal
 * language. Every line has a side a reasonable person could reject. */
const QUESTIONS = [
  ["Robots take more physical jobs than they create.", "Electricity becomes harder to get than oil.", "Crypto becomes everyday money, not just something people trade.", "Living healthy into your nineties becomes normal.", "Countries make more of their own goods, even if it costs more.", "We spend more fixing climate damage than preventing it.", "AI takes over more work than it creates."],
  ["Factories and warehouses run with far fewer people.", "New power cannot keep up with AI and electric everything.", "Stablecoins become a normal way to pay, even for people who dislike crypto.", "Caring for ageing populations costs more than any other public service.", "Governments spend more on defence and making things at home than on cheap imports.", "Protecting cities from climate damage becomes as big as cutting emissions.", "People who do not use AI at work fall behind."],
  ["Robotics creates more value in factories than in homes.", "Power availability holds AI back more than computing chips do.", "Crypto succeeds mainly through systems people barely notice.", "Ageing populations reshape who works more than they reshape healthcare.", "Energy security matters more to governments than cheap energy.", "Climate adaptation grows faster than spending to prevent climate change.", "AI changes old industries more than it creates new ones."],
  ["Robotics changes the physical economy more than AI changes office work.", "Electricity infrastructure outlasts the current AI boom.", "Digital finance keeps blockchain even if most cryptocurrencies disappear.", "Healthcare innovation accelerates, but rules stop it spreading fast.", "Bringing production home costs more and takes longer than governments expect.", "Climate adaptation attracts more money than preventing climate change.", "The world is overestimating AI’s short-term impact and underestimating its long-term reach."],
];
export const DECK_TITLE = "Which futures do you see?";
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
// 4 the seven-domain deck · 5 strongest views · 6 conviction · 7 dislikes · 8 rules.
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

/** One prediction per domain. The opening chart already takes Society and work,
 * so the swipe deck is the other six — answers never skip or reorder them. */
export const PREDICTION_COUNT = CATEGORIES.length;
export const DECK_SIZE = PREDICTION_COUNT - 1;

/** The next uncovered domain, in CATEGORIES order. How the last card was
 * swiped does not change which question comes next; that answer is for the
 * profile and for the scenes after the deck. */
export function nextPrediction(a: OnboardingAnswers, knowledge: number) {
  const asked = new Set(a.responses.map(r => r.category));
  return predictions(knowledge).find(p => !asked.has(p.category));
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
