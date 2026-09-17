import { topicRecommendations } from "./suggestions";
import type { ActivityKind, Asset, HubState, SignalAction } from "./types";
import { isThemeId, THEMES, type ThemeId } from "./themes";
import { DEFAULT_PLAN, learnedAssets, type PlanLimits } from "./plans";

export const MAX_EVENTS = 500;
export function recordEvent(state: HubState, kind: ActivityKind, text: string, detail?: string, tradeId?: string) {
  state.events.push({ id: crypto.randomUUID(), at: new Date().toISOString(), kind, text, detail, tradeId });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

const DELTA: Record<SignalAction, number> = { opened: .08, ignored: -.03, dismissed: -.2, followup: .15, watched: .3, removed: -.3, approved: .15, rejected: -.1 };
const VERB: Record<SignalAction, string> = {
  opened: "Opened", ignored: "Passed on", dismissed: "Dismissed", followup: "Asked more about",
  watched: "Started watching", removed: "Stopped watching", approved: "Approved a trade in", rejected: "Rejected a trade in",
};

function nudge(state: HubState, target: string, delta: number, at: string) {
  let item = state.inferred.find(i => i.id === target);
  if (!item) { item = { id: target, weight: 0, confidence: 0, count: 0, updatedAt: at }; state.inferred.push(item); }
  item.weight = Math.max(-1, Math.min(1, item.weight + delta));
  item.count++; item.confidence = Math.min(.95, item.count / (item.count + 5)); item.updatedAt = at;
  return item;
}

export const LEARNING_FULL_TEXT = "Memory for learned assets is full";

/** Behavioral learning. Explicit preferences remain authoritative; this only
 * moves inferred weights. Asset signals also nudge the asset's themes at half
 * strength so repeated engagement with a sector shows up as a theme interest.
 * Plans cap how many assets can be remembered: at the cap, a new asset is not
 * learned (themes still are) and one event per day says so. */
export function learn(state: HubState, action: SignalAction, target: string, themes: string[] = [], limits: PlanLimits = DEFAULT_PLAN.limits) {
  if (state.agent && !state.agent.capabilities.includes("profile")) return null;
  const at = new Date().toISOString();
  if (state.signals.some(s => s.action === action && s.target === target && Date.parse(s.at) > Date.now() - 60_000)) return null;
  const themeItems = [...new Set(themes.filter(isThemeId))].filter(t => t !== target).map(t => nudge(state, t, DELTA[action] / 2, at));
  if (!isThemeId(target) && !state.inferred.some(i => i.id === target) && learnedAssets(state.inferred) >= limits.learnedAssets) {
    // Refused, so no signal is recorded: the moment the user forgets an asset, the same action learns again.
    if (!state.events.some(e => e.text === LEARNING_FULL_TEXT && Date.parse(e.at) > Date.now() - 86400_000)) {
      recordEvent(state, "learning", LEARNING_FULL_TEXT, `You ${VERB[action].toLowerCase()} ${target}, but I already remember ${limits.learnedAssets} assets on this plan. Forget one in your profile and I’ll start learning new ones again.`);
    }
    return null;
  }
  state.signals.push({ id: crypto.randomUUID(), action, target, at });
  if (state.signals.length > 1000) state.signals.splice(0, state.signals.length - 1000);
  const item = nudge(state, target, DELTA[action], at);
  const strongTheme = themeItems.find(t => t.weight > .45 && t.confidence >= .5 && t.count % 3 === 0);
  recordEvent(state, "learning", `${VERB[action]} ${target}`,
    `Interest in ${target} is now ${Math.round(item.weight * 100)}% (confidence ${Math.round(item.confidence * 100)}%). Inferred from your activity, not something you told me.`);
  if (strongTheme) recordEvent(state, "learning", `Becoming more interested in ${themeName(strongTheme.id)}`, `You keep opening ${themeName(strongTheme.id)} opportunities. I now weight this theme more (${Math.round(strongTheme.weight * 100)}%).`);
  return item;
}

export const themeName = (id: string) => THEMES.find(t => t.id === id)?.name ?? id;

/** Themes the agent believes the user cares about, from inference alone. */
export function inferredThemes(state: HubState, minConfidence = .4): ThemeId[] {
  return state.inferred.filter(i => isThemeId(i.id) && i.weight > .3 && i.confidence >= minConfidence && !state.profile.themes.includes(i.id as ThemeId)).map(i => i.id as ThemeId);
}

export function assetThemes(asset: Pick<Asset, "name" | "description" | "themes" | "symbol">): ThemeId[] {
  const corpus = `${asset.name} ${asset.symbol} ${asset.description ?? ""} ${asset.themes.join(" ")}`;
  return THEMES.filter(t => t.keywords.test(corpus) || asset.themes.includes(t.id)).map(t => t.id);
}

export type Relevance = { score: number; reason: string; label: string; tone: NonNullable<Asset["labelTone"]>; reasons: string[] };

/** Deterministic explanation of why an asset matters to this user. */
export function relevance(asset: Asset, state: HubState): Relevance {
  const corpus = `${asset.name} ${asset.symbol} ${asset.description ?? ""} ${asset.themes.join(" ")}`.toLowerCase();
  const themes = assetThemes(asset);
  const matching = themes.filter(t => state.profile.themes.includes(t));
  const watched = state.profile.interests.some(i => i.symbol?.toUpperCase() === asset.symbol.toUpperCase() || i.id === asset.id);
  const relatedInterests = state.profile.interests.filter(i => i.kind === "custom" && topicRecommendations(i).some(a => a.symbol?.toUpperCase() === asset.symbol.toUpperCase() || a.id === asset.id));
  const dislikes = [...new Set([...state.dislikes, ...(state.profile.investorAnswers.onboarding?.dislikes ?? [])])].filter(d => corpus.includes(d.toLowerCase()) || (d.toLowerCase().includes("meme") && /meme|doge|shiba|pepe|inu/.test(corpus)));
  const preferences = state.preferences.filter(p => corpus.includes(p.toLowerCase()) || themes.some(t => p.toLowerCase().includes(t)));
  const inferred = state.inferred.filter(i => (i.id.toUpperCase() === asset.symbol.toUpperCase() || i.id === asset.id || themes.includes(i.id as ThemeId)) && i.confidence >= .25);
  const inferredScore = inferred.reduce((sum, i) => sum + i.weight * i.confidence, 0);
  const ignored = inferred.filter(i => i.weight < -.15 && i.confidence >= .4);
  const thesisHits = state.profile.thesis.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 5 && corpus.includes(w)).slice(0, 3);
  const score = (watched ? 3 : 0) + relatedInterests.length * 2 + matching.length * 2 + preferences.length * 1.5 + thesisHits.length * .5 + inferredScore * 2 - dislikes.length * 10;
  const reasons = [
    watched ? `You follow ${asset.symbol}` : "",
    ...relatedInterests.map(i => `Connected to your interest in ${i.name}`),
    ...matching.map(t => `Related to your ${themeName(t)} thesis`),
    ...preferences.map(p => `You told me you care about ${p}`),
    thesisHits.length ? `Your thesis mentions ${thesisHits.join(", ")}` : "",
    ...inferred.filter(i => i.weight > .15).map(i => `You’ve been spending time on ${themeName(i.id)}`),
  ].filter(Boolean);
  let label: string, tone: Relevance["tone"];
  if (dislikes.length) { label = `You asked to see less ${dislikes[0]}`; tone = "muted"; }
  else if (relatedInterests.length) { label = `Related to ${relatedInterests[0].name}`; tone = "related"; }
  else if (ignored.length && !watched && !matching.length) { label = "You usually ignore assets like this"; tone = "ignored"; }
  else if (matching.length >= 1 && (watched || preferences.length || matching.length > 1 || thesisHits.length)) { label = `Strong match for your ${themeName(matching[0])} thesis`; tone = "match"; }
  else if (matching.length) { label = `Related to ${themeName(matching[0])}`; tone = "related"; }
  else if (inferredScore > .2) { label = `Close to what you’ve been exploring`; tone = "related"; }
  else if (asset.kind === "crypto" && (asset.marketCap ?? Infinity) < 5e8) { label = "Emerging theme"; tone = "emerging"; }
  else { label = "Outside your usual interests"; tone = "explore"; }
  return { score, label, tone, reasons, reason: reasons.join(". ") || (tone === "muted" ? label : "A chance to look outside your usual interests") };
}

export function personalize(asset: Asset, state: HubState): Asset {
  const r = relevance(asset, state);
  return { ...asset, themes: [...new Set([...asset.themes, ...assetThemes(asset)])], score: r.score, reason: r.reason, label: r.label, labelTone: r.tone };
}
