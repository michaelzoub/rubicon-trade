export const CONFIDENCE = ["I’m here to explore", "I have a few hunches", "Some things feel clear", "I know what I believe"];
export const EXPERIENCE = ["Unknown grounds", "I know the basics", "I am comfortable exploring", "Experienced"];
export const EXPERIENCE_NOTES = ["I’m new or have barely started.", "I understand stocks, ETFs or crypto.", "I can research and compare investments myself.", "I manage my own portfolio and know what I’m looking at."];
export const DISLIKES = ["Non-ESG companies", "ESG companies", "Fossil fuels", "Defence and weapons", "Tobacco", "Gambling", "Memecoins", "Highly speculative investments", "Real estate", "Commodities", "Short-term trading"];
export const CATEGORIES = ["Technology", "Energy", "Money and crypto", "Health and demographics", "Government and geopolitics", "Climate and infrastructure", "Society and work"];
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
  return { version: 1, scene: Number.isInteger(r.scene) && bounded(r.scene, 0, 7) ? r.scene : 0, confidence: Number.isInteger(r.confidence) && bounded(r.confidence, 0, 3) ? r.confidence : null, responses, strongest: Array.isArray(r.strongest) ? [...new Set(r.strongest.filter(id => responses.some(p => p.id === id && p.direction !== "unsure")))].slice(0, 2) : [], dislikes: Array.isArray(r.dislikes) ? DISLIKES.filter(d => r.dislikes.includes(d)) : [], openToEverything: r.openToEverything === true && !r.dislikes?.length, ownBelief: typeof r.ownBelief === "string" ? r.ownBelief.slice(0, 300) : "" };
}
// Scenes: 0 clarity · 1 knowledge · 2 predictions · 3 strongest views ·
// 4 conviction chart · 5 dislikes · 6 geography · 7 rules. Two are conditional.
export const SCENE = { clarity: 0, knowledge: 1, deck: 2, strongest: 3, chart: 4, dislikes: 5, geography: 6, rules: 7 } as const;
const GEOGRAPHY_CATEGORIES = ["Government and geopolitics", "Energy"];
const GEOGRAPHY_DISLIKES = ["Defence and weapons", "Fossil fuels"];
const GEOGRAPHY_WORDS = /\b(defen[cs]e|military|war|conflict|geopolit\w*|energy|oil|gas|nuclear|sanction\w*|tariff\w*|deglobali[sz]\w*|reshor\w*|supply chains?|china|russia|taiwan|nato|ukraine|middle east)\b/i;
/** Geography is asked only when the answers already point at the world map:
 * a strongly held energy or geopolitics view, a values-driven dislike, or an
 * own belief that names the terrain. */
export function needsGeography(a: OnboardingAnswers) {
  return a.responses.some(r => a.strongest.includes(r.id) && GEOGRAPHY_CATEGORIES.includes(r.category))
    || a.dislikes.some(d => GEOGRAPHY_DISLIKES.includes(d))
    || GEOGRAPHY_WORDS.test(a.ownBelief);
}
export function sceneOrder(a: OnboardingAnswers) {
  return [SCENE.clarity, SCENE.knowledge, SCENE.deck, SCENE.strongest, ...(a.strongest.length ? [SCENE.chart] : []), SCENE.dislikes, ...(needsGeography(a) ? [SCENE.geography] : []), SCENE.rules];
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
