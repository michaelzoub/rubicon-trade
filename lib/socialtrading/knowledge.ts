import { isThemeId } from "./themes";
import { convictionsOf } from "./worldview";
import { maturityOf } from "./identity-palette";
import type { IdentityStats } from "./identity";
import type { HubState } from "./types";

/**
 * What the agent knows about a person, as areas rather than statistics. Size is
 * how much it holds; colour is how sure it is; a dim, small area is a gap —
 * which is the point. Nothing here is a score to chase: every number below is
 * read out of what the person has actually put in.
 */
export type KnowledgeArea = {
  id: string;
  name: string;
  /** 0–1. Drives the size of the body. */
  known: number;
  /** 0–1. Drives its colour. Zero reads as unformed rather than wrong. */
  confidence: number;
  /** What it knows, in one line, revealed rather than printed. */
  detail: string;
  /** What would fill the gap, when there is one. */
  gap: string | null;
  /** The part of the page this area belongs to. */
  facet: string;
};

const ratio = (value: number, full: number) => Math.min(1, Math.max(0, value / full));
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

export function knowledgeOf(state: HubState, stats: IdentityStats, depth: number): KnowledgeArea[] {
  const convictions = convictionsOf(state);
  const themes = state.inferred.filter(i => isThemeId(i.id));
  const assets = state.inferred.filter(i => !isThemeId(i.id));
  const behaviours = state.preferences.length + state.dislikes.length;

  return [
    {
      id: "convictions", name: "Convictions", facet: "Your point of view",
      known: ratio(convictions.length, 6),
      confidence: mean(convictions.map(c => c.strength)),
      detail: convictions.length ? `${convictions.length} ${convictions.length === 1 ? "belief" : "beliefs"}, held at ${Math.round(mean(convictions.map(c => c.strength)) * 100)}% on average` : "Nothing stated yet",
      gap: convictions.length >= 3 ? null : "Tell your agent what you believe and why",
    },
    {
      id: "interests", name: "Interests", facet: "What you care about",
      known: ratio(state.profile.interests.length, 8),
      confidence: state.profile.interests.length ? 1 : 0,
      detail: state.profile.interests.length ? `Watching ${state.profile.interests.map(i => i.symbol || i.name).slice(0, 4).join(", ")}${state.profile.interests.length > 4 ? ` and ${state.profile.interests.length - 4} more` : ""}` : "Nothing being watched",
      gap: state.profile.interests.length ? null : "Follow something you already have a view on",
    },
    {
      id: "understanding", name: "Understanding", facet: "What your agent remembers",
      known: ratio(new Set([...state.profile.themes, ...themes.filter(t => t.weight > .3).map(t => t.id)]).size, 4),
      confidence: mean(themes.map(t => t.confidence)),
      detail: themes.length ? `${themes.length} ${themes.length === 1 ? "theme" : "themes"} worked out, ${Math.round(mean(themes.map(t => t.confidence)) * 100)}% sure` : "Still getting to know you",
      gap: themes.length ? null : "Open a few things and let it draw its own conclusions",
    },
    {
      id: "behaviours", name: "Behaviours", facet: "What you care about",
      known: ratio(behaviours, 8),
      confidence: behaviours ? ratio(behaviours, 4) : 0,
      detail: behaviours ? `${state.preferences.length} things you want more of, ${state.dislikes.length} you want less` : "No leanings recorded",
      gap: behaviours >= 3 ? null : "Say what you want more and less of",
    },
    {
      id: "discoveries", name: "Discoveries", facet: "What your agent remembers",
      known: ratio(stats.discoveries, 5),
      confidence: mean(assets.map(a => a.confidence)),
      detail: stats.discoveries ? `${stats.discoveries} ${stats.discoveries === 1 ? "thing" : "things"} it found on its own` : "Nothing found on its own yet",
      gap: stats.discoveries ? null : "Leave an agent awake and it will go looking",
    },
    {
      id: "signals", name: "Signals", facet: "What your agent remembers",
      known: ratio(stats.signals, 60),
      confidence: ratio(stats.signals, 20),
      detail: stats.signals ? `${stats.signals} ${stats.signals === 1 ? "signal" : "signals"} read from what you opened, kept and passed on` : "Nothing read yet",
      gap: stats.signals >= 10 ? null : "Every thing you open or pass on teaches it something",
    },
    {
      id: "progression", name: "Progression", facet: "Plan & wallets",
      known: maturityOf(depth),
      confidence: maturityOf(depth),
      detail: `${stats.days} ${stats.days === 1 ? "day" : "days"} in, ${stats.trades} ${stats.trades === 1 ? "decision" : "decisions"} made`,
      gap: maturityOf(depth) >= .6 ? null : "It fills in on its own as you use it",
    },
  ];
}

/** Where each area sits, on a ring, so the shape of a person is read at a glance. */
export function knowledgePoint(index: number, count: number): { x: number; y: number } {
  const radians = (index / count) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + Math.cos(radians) * 33, y: 50 + Math.sin(radians) * 33 };
}
