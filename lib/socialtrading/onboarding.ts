import { suggestedThemes, type ThemeId } from "./themes";

export const CONVICTION_TITLE = "How clear are your views about the future?";
export const CONVICTION_LEAD = "Think technology, energy, society and money. Move the dial to what sounds like you.";
export const CONFIDENCE = ["I’m still exploring", "I have a few ideas", "I know what I believe", "I have strong convictions"];
export const CONFIDENCE_STOPS = ["Exploring", "A few ideas", "Clear views", "Strong convictions"];
export const CONFIDENCE_NOTES = [
  "I don’t have specific convictions yet.",
  "Some trends feel important, but my views are still forming.",
  "I have clear views about several trends.",
  "I already know which changes I expect to shape the future.",
];
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
  ["By 2035, robots will eliminate more physical jobs than they create.", "By 2030, electricity becomes harder to get than oil.", "By 2032, crypto becomes everyday money, not just something people trade.", "By 2040, living healthy into your nineties becomes normal.", "By 2035, countries make more of their own goods, even if it costs more.", "By 2040, we spend more fixing climate damage than preventing it.", "By 2030, AI takes over more work than it creates."],
  ["By 2035, factories and warehouses run with far fewer people.", "By 2030, new power cannot keep up with AI and electric everything.", "By 2032, stablecoins become a normal way to pay, even for people who dislike crypto.", "By 2040, caring for ageing populations costs more than any other public service.", "By 2035, governments spend more on defence and making things at home than on cheap imports.", "By 2040, protecting cities from climate damage becomes as big as cutting emissions.", "By 2030, people who do not use AI at work fall behind."],
  ["By 2035, robotics creates more value in factories than in homes.", "By 2030, power availability holds AI back more than computing chips do.", "By 2032, crypto succeeds mainly through systems people barely notice.", "By 2040, ageing populations reshape who works more than they reshape healthcare.", "By 2035, energy security matters more to governments than cheap energy.", "By 2040, climate adaptation grows faster than spending to prevent climate change.", "By 2035, AI changes old industries more than it creates new ones."],
  ["By 2040, robotics changes the physical economy more than AI changes office work.", "By 2035, electricity infrastructure outlasts the current AI boom.", "By 2035, digital finance keeps blockchain even if most cryptocurrencies disappear.", "By 2040, healthcare innovation accelerates, but rules stop it spreading fast.", "By 2035, bringing production home costs more and takes longer than governments expect.", "By 2040, climate adaptation attracts more money than preventing climate change.", "By 2035, the world is overestimating AI’s short-term impact and underestimating its long-term reach."],
];
export const DECK_TITLE = "What do you think comes next?";
export const DECK_LEAD = "Swipe right if it feels likely, left if unlikely, or down if you’re unsure.";
/** Opening phrase a swipe can judge: a year, a span, or a decade. */
const SPAN = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)";
export const HORIZON_RE = new RegExp(`^(By \\d{4}|Within (?:the next )?${SPAN} years|In the next ${SPAN} years|This decade|By the \\d{4}s)`, "i");
export function splitPrediction(text: string): { horizon: string | null; claim: string } {
  const match = text.match(HORIZON_RE);
  if (!match) return { horizon: null, claim: text };
  const rest = text.slice(match[0].length).replace(/^,\s*/, "").trim();
  if (!rest) return { horizon: match[0], claim: text };
  return { horizon: match[0], claim: rest.charAt(0).toUpperCase() + rest.slice(1) };
}
export function ensureHorizon(text: string, horizon = "By 2035"): string {
  if (HORIZON_RE.test(text)) return text;
  return `${horizon}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
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

/** What the side card should show *now*, from answers already taken. Thesis
 * stays blank until a view is actually decided, so the card does not invent a
 * belief the person has not chosen. Before strongest views are picked, the
 * first decided swipes stand in so the card moves with the deck. */
export function onboardingPreview(a: OnboardingAnswers): { thesis: string; themes: ThemeId[]; portrait: string } {
  const decided = a.responses.filter(r => r.direction !== "unsure");
  const selected = a.strongest.length ? decided.filter(r => a.strongest.includes(r.id)) : decided.slice(0, 2);
  const thesis = [...selected.map(r => `${r.direction === "yes" ? "I expect" : "I do not expect"}: ${r.text}${r.confidence ? ` Confidence in this view: ${r.confidence}%.` : ""}${r.years ? ` Horizon: ${r.years === 11 ? "more than ten" : r.years} years.` : ""}`), a.ownBelief.trim()].filter(Boolean).join("\n");
  const yes = a.responses.filter(r => r.direction === "yes");
  const themes = suggestedThemes([...yes.map(r => `${r.category} ${r.text}`), a.ownBelief].join(" "));
  return { thesis, themes, portrait: onboardingPortrait(a) };
}

const STANCE = ["Still exploring", "A few ideas", "Clear views", "Strong convictions"] as const;

function joinAnd(words: string[]) {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function lens(category: string) {
  return KEYWORDS[CATEGORIES.indexOf(category)] ?? category;
}

/** One phrase for the last screen — who they are, not a dump of what they typed. */
export function onboardingPortrait(a: OnboardingAnswers): string {
  const stance = STANCE[a.confidence ?? 0];
  const decided = a.responses.filter(r => r.direction !== "unsure");
  const pool = a.strongest.length ? decided.filter(r => a.strongest.includes(r.id)) : decided;
  const yes = pool.filter(r => r.direction === "yes").slice(0, 2).map(r => lens(r.category));
  const no = pool.filter(r => r.direction === "no").slice(0, 1).map(r => lens(r.category));
  if (!yes.length && !no.length) {
    return a.confidence === 3 ? "Strong convictions, still unnamed."
      : a.confidence === 2 ? "Clear views, still unnamed."
      : a.confidence === 1 ? "A few ideas, still looking around."
      : "Still exploring the future.";
  }
  if (yes.length && no.length) return `${stance} on ${joinAnd(yes)}, skeptical of ${no[0]}.`;
  if (yes.length) return `${stance} around ${joinAnd(yes)}.`;
  return `${stance}, skeptical of ${joinAnd(no)}.`;
}
