import { CATEGORIES, ensureHorizon, type OnboardingAnswers } from "./onboarding";
import type { ProbeKind, ProfileModel } from "./profile-model";
import { PROBE_TOPICS, probeTopic, topicName, type ProbeTopic, type TopicId } from "./profile-topics";

/**
 * The sequencer. Every threshold in adaptive onboarding lives here, in pure
 * arithmetic over what Jev read — the model is never asked what to do next,
 * only what the evidence says. That split is the point: a probability is a
 * judgment, and choosing a question is a policy.
 */

/** Hard ceiling. A run is seven probes at most, however unsure we still are. */
export const MAX_PROBES = 7;
/** Floor. Below this a run always continues, so a decisive person still gets a
 * sequence with a shape rather than two questions and a summary. */
export const MIN_PROBES = 3;
/** Below this probability a topic is never asked about. */
export const SUPPRESS = 0.15;
/** A reading this sure, this far from the middle, is knowledge — not a question. */
export const KNOWN_CERTAINTY = 0.8, KNOWN_MARGIN = 0.3;
/** Past the floor, a best candidate worth less than this ends the run. */
export const MIN_VALUE = 0.05;
/** How close the top three must be before we let the person break the tie. */
export const TIE = 0.15;
/** The funnel. Early probes are about coverage, so they go wide: an untouched
 * domain outranks a marginally better question inside one we have already been
 * in. By the end that inverts and the run digs into the domains the person
 * actually engaged with. `FUNNEL` is how much of a candidate's score this can
 * move — enough to steer the order, never enough to resurrect a topic the
 * evidence has already suppressed. */
export const BROAD_TURNS = 2, DEEP_TURN = 4, FUNNEL = 0.4;

export const probeId = (id: TopicId) => `probe:${id}`;

export type Candidate = { topic: ProbeTopic; p: number; certainty: number; value: number };

export type Probe = {
  id: string;
  kind: ProbeKind;
  title: string;
  lead: string;
  topics: TopicId[];
  category: string;
  /** `choice`, `spectrum` and `chips` carry labels; the others explain themselves. */
  options?: string[];
};

export type ProbeContext = { knowledge: number; confidence: number; answers: OnboardingAnswers };

/** Four stops, because a spectrum answer is stored as a `scale` index and
 * `applyAnswer` reads it as `options[value]`. A raw fraction would index nothing. */
export const SPECTRUM_STOPS = ["Strongly against", "Leaning against", "Leaning toward", "Strongly toward"];

/**
 * Every topic still worth a question, best first.
 *
 * Relevance is the probability itself: a topic they probably care about earns
 * a question, one they probably do not does not. Uncertainty blends two
 * different ignorances — the reading sits near the middle, or the model is not
 * sure of its own reading. Importance is the static prior, so a topic that
 * barely moves a portfolio cannot win on uncertainty alone.
 */
export function rankTopics(model: ProfileModel): Candidate[] {
  // Which domains have already been asked about. Early in a run this pushes the
  // next question out of them; late it pulls the next question back in.
  const touched = new Set(model.evidence.flatMap(e => e.topics.map(id => probeTopic(id)?.category)));
  const stage = Math.min(1, model.turn / MAX_PROBES);
  const candidates: Candidate[] = [];
  for (const belief of model.beliefs) {
    const topic = probeTopic(belief.topic);
    if (!topic) continue;
    if (belief.p < SUPPRESS) continue;
    if (belief.certainty >= KNOWN_CERTAINTY && Math.abs(belief.p - 0.5) > KNOWN_MARGIN) continue;
    if (model.asked.includes(probeId(topic.id))) continue;
    const spread = 1 - Math.abs(2 * belief.p - 1);
    const uncertainty = 0.6 * spread + 0.4 * (1 - belief.certainty);
    const novel = touched.has(topic.category) ? 0 : 1;
    const funnel = (1 - stage) * novel + stage * (1 - novel);
    candidates.push({ topic, p: belief.p, certainty: belief.certainty, value: belief.p * uncertainty * topic.importance * (1 - FUNNEL + FUNNEL * funnel) });
  }
  // The id tiebreak keeps the order stable, so a run is reproducible in a test.
  return candidates.sort((a, b) => b.value - a.value || a.topic.id.localeCompare(b.topic.id));
}

const level = (knowledge: number) => Math.max(0, Math.min(3, Math.floor(knowledge)));
const usedKind = (model: ProfileModel, kind: ProbeKind) => model.evidence.some(e => e.kind === kind);

/**
 * Which interaction closes this particular gap. Ordered, first match wins.
 * Every kind but `choice` is spent at most once, so a run never repeats an
 * instrument — variety is a by-product of the gaps, not a goal of its own.
 *
 * The three stages are the funnel. Opening probes are always a swipe, because
 * the job is a wide read and one gesture is the fastest way to take it. The
 * middle asks where, and how strongly. Conviction, horizon and freeform come
 * last, once there is a shape worth deepening — asking someone how sure they
 * are before you know what they think is asking them to invent an opinion.
 *
 * This is keyed on `turn`, not on how many beliefs exist. The first reading
 * scores every topic in the catalog, so a belief count would be fifteen from
 * turn one and the broad stage would never happen.
 */
function chooseKind(best: Candidate, ranked: Candidate[], model: ProfileModel, ctx: ProbeContext): ProbeKind {
  if (model.turn < BROAD_TURNS) return "choice";
  if (best.topic.geographic && !usedKind(model, "map")) return "map";
  if (Math.abs(best.p - 0.5) > 0.25 && best.certainty < 0.6 && !usedKind(model, "spectrum")) return "spectrum";
  if (model.turn >= DEEP_TURN) {
    const hasHorizon = ctx.answers.responses.some(r => r.years !== undefined);
    if (best.p > 0.7 && best.certainty > 0.6 && !hasHorizon && !usedKind(model, "pad")) return "pad";
    if (ctx.knowledge >= 2 && !usedKind(model, "text")) return "text";
  }
  if (ranked.length >= 3 && best.value - ranked[2].value <= TIE * best.value && !usedKind(model, "chips")) return "chips";
  return "choice";
}

const TOPIC_HORIZON: Record<string, string> = {
  semiconductors: "By 2032", "data-centers": "By 2030", "cloud-software": "By 2035", robotics: "By 2035",
  "power-grid": "By 2030", "digital-money": "By 2035", stablecoins: "By 2032", "decentralized-finance": "By 2035",
  biotech: "By 2040", "medical-technology": "By 2035", "defence-sovereignty": "By 2035", "climate-adaptation": "By 2040",
  "ai-applications": "By 2030", "future-of-work": "By 2035", "consumer-trends": "By 2032",
};
const titled = (topic: ProbeTopic, knowledge: number) =>
  ensureHorizon(topic.claims[level(knowledge)], TOPIC_HORIZON[topic.id] ?? "By 2035");

function build(best: Candidate, ranked: Candidate[], model: ProfileModel, ctx: ProbeContext): Probe {
  const kind = chooseKind(best, ranked, model, ctx);
  const claim = titled(best.topic, ctx.knowledge);
  const base = { id: probeId(best.topic.id), category: best.topic.category };
  if (kind === "chips") {
    const tied = ranked.slice(0, 3);
    return { ...base, kind, title: "Which of these actually matter to you?", lead: "Pick the ones you would want watched on your behalf.", topics: tied.map(c => c.topic.id), options: tied.map(c => topicName(c.topic.id)) };
  }
  if (kind === "spectrum") return { ...base, kind, title: claim, lead: "How strongly?", topics: [best.topic.id], options: SPECTRUM_STOPS };
  if (kind === "map") return { ...base, kind, title: claim, lead: "Choose where you think this plays out.", topics: [best.topic.id] };
  if (kind === "pad") return { ...base, kind, title: claim, lead: "How sure are you, and how soon?", topics: [best.topic.id] };
  if (kind === "text") return { ...base, kind, title: "What have we not asked about?", lead: "In your own words — one or two lines is plenty.", topics: [best.topic.id] };
  return { ...base, kind: "choice", title: claim, lead: "Take a side.", topics: [best.topic.id] };
}

/** Jev never answered, so there is nothing to rank. Walk the seven domains in
 * order — the fixed sequence is the floor under the adaptive one, not a
 * competing arm. */
function fallback(model: ProfileModel, ctx: ProbeContext): Probe | null {
  const covered = new Set(model.evidence.flatMap(e => e.topics.map(id => probeTopic(id)?.category)));
  const category = CATEGORIES.find(name => !covered.has(name));
  const topic = category ? PROBE_TOPICS.find(t => t.category === category) : undefined;
  if (!topic || !category) return null;
  return { id: probeId(topic.id), kind: "choice", title: titled(topic, ctx.knowledge), lead: "Take a side.", topics: [topic.id], category };
}

/**
 * The next thing to ask, or `null` when the run is over.
 *
 * Sequencing, length and instrument are all decided here. Jev contributed the
 * two numbers on each belief and nothing else.
 */
export function getNextProfileProbe(model: ProfileModel, ctx: ProbeContext): Probe | null {
  if (model.turn >= MAX_PROBES) return null;
  if (!model.beliefs.length) return fallback(model, ctx);
  const ranked = rankTopics(model);
  if (!ranked.length) return null;
  const best = ranked[0];
  if (model.turn >= MIN_PROBES && best.value < MIN_VALUE) return null;
  return build(best, ranked, model, ctx);
}
