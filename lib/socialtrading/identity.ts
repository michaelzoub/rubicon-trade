import { isThemeId, THEMES, type ThemeId } from "./themes";
import type { AgentConfig } from "./agents/config";
import type { HubState } from "./types";

/**
 * Who someone has become, read from what they already have. Nothing here is
 * stored: the aura, the stage and the milestones are all derived, so the
 * picture moves on its own as the person explores and their agents learn.
 *
 * The badge palette in themes.ts is dusty and material because a badge is an
 * object. An aura is atmosphere, so it gets its own lighter, airier palette.
 */
export const AURA: Record<ThemeId, { glow: string; deep: string; mark: string }> = {
  energy: { glow: "#ffe3a3", deep: "#e0ab51", mark: "EN" },
  tech: { glow: "#b9d7ff", deep: "#6d9ee2", mark: "TE" },
  ai: { glow: "#d6c4ff", deep: "#9b83dd", mark: "AI" },
  crypto: { glow: "#a9eed4", deep: "#58c19a", mark: "CR" },
  healthcare: { glow: "#ffc3d8", deep: "#df7f9e", mark: "HC" },
  consumer: { glow: "#ffd4b2", deep: "#df9868", mark: "CO" },
};
/** Before anyone picks a theme the aura is still theirs, just unformed. */
export const AURA_UNFORMED = [{ glow: "#dee6ff", deep: "#8595d2" }, { glow: "#ebdeff", deep: "#9b85cf" }, { glow: "#d6ecff", deep: "#79a4cd" }];

/** FNV-1a over a versioned seed, matching avatarTraits so identity is stable forever. */
export function identityHash(seed: string) {
  let state = 2166136261;
  for (const char of `rubicon-aura-v1:${seed}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return state >>> 0;
}
/** Deterministic 0–1 stream. Server and client must compose the same aura, so nothing here may use Math.random. */
export function seededRandom(seed: string) {
  let state = identityHash(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
/** The four characters printed under the name. Two people with the same themes still read differently. */
export const identityCode = (seed: string) => identityHash(seed).toString(16).toUpperCase().padStart(8, "0").slice(0, 4);

/** One soft blob of colour in the aura. Everything is pre-computed so the component only draws. */
export type AuraLobe = {
  id: string; glow: string; deep: string;
  /** How strongly this theme is held, 0–1. Drives radius and opacity. */
  weight: number;
  /** Placement in the composition, in SVG units on a 320-box. */
  x: number; y: number; radius: number;
  /** Seconds for one drift cycle, and how far it travels. */
  drift: number; travel: number; delay: number;
};

/**
 * Compose the aura. Explicit themes carry full weight; what the agents worked
 * out on their own drifts in at a third, the same ratio the badge uses, so a
 * person can see their agents shading their identity without it being taken over.
 */
export function auraLobes(seed: string, themes: readonly ThemeId[], inferred: HubState["inferred"] = []): AuraLobe[] {
  const random = seededRandom(seed);
  const explicit = themes.filter(id => id in AURA).map(id => ({ id: id as string, ...AURA[id], weight: 1 }));
  const learned = inferred
    .filter(i => isThemeId(i.id) && i.weight > .3 && i.confidence >= .4 && !themes.includes(i.id as ThemeId))
    .map(i => ({ id: i.id, ...AURA[i.id as ThemeId], weight: Math.min(.55, Math.max(.28, i.weight * i.confidence)) }));
  const held = [...explicit, ...learned];
  // An unformed aura still has to be worth looking at: it is the first thing a new person sees of themselves.
  const sources = held.length ? held : AURA_UNFORMED.map((tone, i) => ({ id: `unformed-${i}`, ...tone, weight: .68 }));
  // A fixed rotation per person, then even spacing with a seeded wobble, so no
  // two auras sit the same way up and none of them look mechanically arranged.
  const turn = random() * Math.PI * 2;
  return sources.map((source, i) => {
    const angle = turn + (i * Math.PI * 2) / sources.length + (random() - .5) * .7;
    const distance = 26 + random() * 18 + (1 - source.weight) * 12;
    return {
      ...source,
      x: 160 + Math.cos(angle) * distance,
      y: 160 + Math.sin(angle) * distance,
      radius: 58 + source.weight * 36 + random() * 10,
      drift: 11 + random() * 9,
      travel: 8 + random() * 12,
      delay: random() * 4,
    };
  });
}

/** The counts worth saying out loud. Each one is something the person did, not a score. */
export type IdentityStats = {
  /** Every observation the agents have folded in. */
  signals: number;
  /** Assets and ideas being watched on purpose. */
  watching: number;
  /** Distinct things the agents noticed without being told. */
  discoveries: number;
  themes: number;
  agents: number;
  awake: number;
  trades: number;
  conversations: number;
  /** Events in the last seven days: how warm the page should feel. */
  energy: number;
  /** Days since the first agent started. */
  days: number;
};

export function identityStats(state: HubState, agents: AgentConfig[] = [], now = Date.now()): IdentityStats {
  const started = [state.profile.completedAt, ...agents.map(a => a.createdAt), state.events.at(0)?.at]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map(Date.parse);
  const week = now - 7 * 86_400_000;
  return {
    signals: state.inferred.reduce((total, i) => total + i.count, 0),
    watching: state.profile.interests.length,
    discoveries: state.inferred.filter(i => !isThemeId(i.id)).length,
    themes: new Set([...state.profile.themes, ...state.inferred.filter(i => isThemeId(i.id) && i.weight > .3 && i.confidence >= .4).map(i => i.id)]).size,
    agents: Math.max(agents.length, state.agent ? 1 : 0),
    awake: agents.filter(a => a.enabled).length,
    trades: state.trades.length,
    conversations: state.chats.length,
    energy: state.events.filter(e => Date.parse(e.at) >= week).length,
    days: started.length ? Math.max(0, Math.floor((now - Math.min(...started)) / 86_400_000)) : 0,
  };
}

/** How far an identity has come. Named rather than numbered: a level number would read like a game, a state reads like a person. */
export const STAGES = [
  { name: "Forming", line: "Your shape is still settling." },
  { name: "Emerging", line: "A point of view is showing through." },
  { name: "Defined", line: "Your agents know what you are looking for." },
  { name: "Distinct", line: "Nobody else reads the market quite like this." },
  { name: "Singular", line: "Fully your own." },
] as const;
const THRESHOLDS = [0, 30, 70, 130, 200];

/** Weighted from everything a person has actually put in, so it cannot be farmed by one action. */
export function identityDepth(state: HubState, stats: IdentityStats): number {
  return Math.round(
    (state.profile.thesis.trim() ? 10 : 0)
    + Math.min(4, state.profile.themes.length) * 6
    + Math.min(8, stats.watching) * 4
    + Math.min(10, state.preferences.length + state.dislikes.length) * 2
    + Math.min(60, stats.signals)
    + stats.agents * 8 + stats.awake * 4
    + Math.min(6, stats.trades) * 5
    + Math.min(20, state.events.length),
  );
}

export type IdentityStage = {
  index: number; name: string; line: string;
  /** 0–1 through the current stage. The ring around the aura draws this. */
  progress: number;
  next: string | null;
  depth: number;
};

export function identityStage(depth: number): IdentityStage {
  const index = THRESHOLDS.reduce((found, threshold, i) => depth >= threshold ? i : found, 0);
  const floor = THRESHOLDS[index], ceiling = THRESHOLDS[index + 1];
  const last = index === STAGES.length - 1;
  return {
    index, ...STAGES[index], depth,
    progress: last ? 1 : Math.min(1, Math.max(0, (depth - floor) / (ceiling - floor))),
    next: last ? null : STAGES[index + 1].name,
  };
}

/**
 * The one thing that would move an identity on the most right now, said as
 * something to do rather than as points to earn.
 */
export function nextStep(state: HubState, stats: IdentityStats, agentCap: number): string {
  if (!state.profile.thesis.trim()) return "Tell your agent what you believe.";
  if (state.profile.themes.length < 2) return "Name another theme you care about.";
  if (stats.watching < 3) return "Watch another asset or idea.";
  if (!stats.awake) return "Wake an agent and let it look around.";
  if (stats.agents < agentCap) return "Begin another agent with a different thesis.";
  if (stats.signals < 25) return "Keep exploring — every look sharpens the picture.";
  return "Ask your agent what it has learned about you.";
}

export type Milestone = { id: string; name: string; note: string; earned: boolean };

/** Named moments, not points. Locked ones say exactly what they take. */
export function milestones(state: HubState, stats: IdentityStats): Milestone[] {
  return [
    { id: "thesis", name: "First words", note: "Write your point of view", earned: state.profile.thesis.trim().length > 0 },
    { id: "themes", name: "A worldview", note: "Hold two themes at once", earned: state.profile.themes.length >= 2 },
    { id: "watching", name: "Watchlist", note: "Watch three assets or ideas", earned: stats.watching >= 3 },
    { id: "listening", name: "It is listening", note: "Give your agent ten signals", earned: stats.signals >= 10 },
    { id: "awake", name: "Awake", note: "Have an agent looking for you", earned: stats.awake >= 1 },
    { id: "team", name: "A team", note: "Run a second agent", earned: stats.agents >= 2 },
    { id: "move", name: "First move", note: "Get a trade proposed to you", earned: stats.trades >= 1 },
    { id: "read", name: "Read closely", note: "Reach twenty-five signals", earned: stats.signals >= 25 },
  ];
}

/** Themes in the order the person chose them, which is not the order the catalogue lists them in. */
const held = (themes: readonly ThemeId[]) => themes.map(id => THEMES.find(t => t.id === id)).filter((t): t is typeof THEMES[number] => !!t);

/** `AI × Energy`, or what the agents think it is, or an honest blank. */
export function identityLine(themes: readonly ThemeId[], inferred: HubState["inferred"] = []): string {
  const chosen = held(themes).map(t => t.name);
  if (chosen.length) return chosen.join(" × ");
  const learned = inferred.filter(i => isThemeId(i.id) && i.weight > .3 && i.confidence >= .4).map(i => THEMES.find(t => t.id === i.id)!.name);
  return learned.length ? `${learned.join(" × ")}, so far` : "Still open";
}

/** The mono strip under the name: `AUR·7C3E · DAY 9`. The themes are spelled out
 * in words on the next line, so repeating them here as marks would say it twice. */
export function identitySignature(seed: string, days: number): string {
  return `AUR·${identityCode(seed)}  ·  DAY ${days}`;
}
