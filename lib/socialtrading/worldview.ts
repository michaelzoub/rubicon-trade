import type { Asset, HubState } from './types';
import { THEMES } from './themes';
export type Conviction = { id: string; text: string; strength: number; themes: string[]; origin: string; updatedAt: string };
export type MemoryFrame = { id: string; at: string; title: string; convictions: Conviction[]; interests: string[]; understanding: string[] };
export type Worldview = { excluded?: string[]; convictions: Conviction[]; memories: MemoryFrame[] };
export function convictionsOf(state: HubState): Conviction[] {
  const explicit = (state.worldview && state.worldview.convictions.map(c => c.text).join("\n") === state.profile.thesis ? state.worldview.convictions : undefined) ?? state.profile.thesis.split(/(?<=[.!?])\s+|\n+/).filter(Boolean).map((text, i) => ({ id: `thesis-${i}`, text, strength: .75, themes: THEMES.filter(t => t.keywords.test(text)).map(t => t.id), origin: 'Your stated thesis', updatedAt: state.profile.updatedAt }));
  return [...explicit, ...state.inferred.filter(i => !state.worldview?.excluded?.includes(`learned-${i.id}`) && i.weight > .2 && !explicit.some(c => c.themes.includes(i.id))).map(i => ({ id: `learned-${i.id}`, text: `Growing interest in ${THEMES.find(t => t.id === i.id)?.name ?? i.id}`, strength: Math.max(.1, i.confidence * i.weight), themes: [i.id], origin: `Agent inference · ${i.count} interactions. An interest, not yet a confirmed belief.`, updatedAt: i.updatedAt }))];
}
export function relevance(asset: Asset, beliefs: Conviction[], state: HubState) {
  const rejected = state.signals.filter(s => s.target === asset.id || s.target === asset.symbol).at(-1);
  if (rejected && ['rejected', 'dismissed', 'ignored'].includes(rejected.action)) return .06;
  const match = Math.max(0, ...beliefs.filter(c => c.themes.some(t => asset.themes.includes(t))).map(c => c.strength));
  return Math.min(1, .18 + match * .65 + (state.profile.interests.some(i => i.symbol === asset.symbol || i.id === asset.id) ? .17 : 0));
}
export function changeConviction(state: HubState, input: { id: string; text: string; strength: number; remove?: boolean }, at = new Date().toISOString()): void {
  if (!input.id || input.id.length > 100 || !input.text.trim() || input.text.length > 1000 || !Number.isFinite(input.strength) || input.strength < 0 || input.strength > 1) throw new Error('Check the belief and its strength.');
  const before = convictionsOf(state);
  if (!input.remove && !before.some(c => c.id === input.id) && before.length >= 30) throw new Error('Keep your thesis to 30 convictions.');
  const snapshot = (convictions: Conviction[], title: string): MemoryFrame => ({ id: `${at}-${title}`, at, title, convictions: structuredClone(convictions), interests: state.profile.interests.map(i => i.name), understanding: state.inferred.map(i => `${i.id}: ${Math.round(i.confidence * 100)}% confidence`) });
  const memories = state.worldview?.memories ?? [snapshot(before, 'Your first recorded worldview')];
  const updated = { id: input.id, text: input.text.trim(), strength: input.strength, themes: THEMES.filter(t => t.keywords.test(input.text)).map(t => t.id), origin: 'Confirmed by you', updatedAt: at };
  const next = input.remove ? before.filter(c => c.id !== input.id) : before.some(c => c.id === input.id) ? before.map(c => c.id === input.id ? updated : c) : [...before, updated];
  if (next.map(c => c.text).join('\n').length > 4000) throw new Error('Keep your thesis under 4,000 characters.');
  const title = input.remove ? `Let go of “${input.text}”` : `Reconsidered “${input.text}”`;
  state.worldview = { excluded: input.remove ? [...(state.worldview?.excluded ?? []), input.id] : (state.worldview?.excluded ?? []).filter(id => id !== input.id), convictions: next, memories: [...memories, snapshot(next, title)].slice(-120) };
  state.profile.thesis = next.map(c => c.text).join('\n');
  state.profile.updatedAt = at;
}

/** Capture meaningful changes wherever they originate, including agent learning. */
export function captureWorldview(state: HubState, at = new Date().toISOString()) {
  const convictions = convictionsOf(state);
  const interests = state.profile.interests.map(i => i.name);
  const understanding = state.inferred.map(i => `${i.id}: ${Math.round(i.confidence * 100)}% confidence`);
  const last = state.worldview?.memories.at(-1);
  if (last && JSON.stringify([last.convictions.map(({ updatedAt, ...c }) => c), last.interests, last.understanding]) === JSON.stringify([convictions.map(({ updatedAt, ...c }) => c), interests, understanding])) return;
  const frame: MemoryFrame = { id: `${at}-${state.revision}`, at, title: last ? 'Your agent’s understanding evolved' : 'Your first recorded worldview', convictions: structuredClone(convictions), interests, understanding };
  state.worldview = { ...state.worldview, convictions: state.worldview?.convictions ?? convictions, memories: [...(state.worldview?.memories ?? []), frame].slice(-120) };
}

/**
 * Where each theme lives, forever. Direction is geography, not decoration: a
 * person learns that energy is up and crypto is down, and afterwards they know
 * where to look before the page has finished arriving.
 */
export const THEME_BEARING: Record<string, number> = { energy: 0, tech: 60, ai: 120, crypto: 180, healthcare: 240, consumer: 300 };

/** Stable pseudo-bearing for something that belongs to no theme, so an
 * unclassified asset still has a home rather than a random one each render. */
function strayBearing(key: string): number {
  let state = 2166136261;
  for (const char of `rubicon-bearing-v1:${key}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return (state >>> 0) % 360;
}

/** The resultant direction of everything an asset belongs to. */
export function bearing(themes: readonly string[], key = ""): number {
  const known = themes.filter(t => t in THEME_BEARING);
  if (!known.length) return strayBearing(key);
  const x = known.reduce((sum, t) => sum + Math.cos(THEME_BEARING[t] * Math.PI / 180), 0);
  const y = known.reduce((sum, t) => sum + Math.sin(THEME_BEARING[t] * Math.PI / 180), 0);
  // Themes exactly opposite each other cancel; fall back to the first, which is
  // more useful than dropping the asset in the middle of the field.
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return THEME_BEARING[known[0]];
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export type Placement = {
  /** Degrees clockwise from north. */
  angle: number;
  /** Distance from the centre as a percentage of the field. */
  radius: number;
  /** 0–1. Drives scale and opacity, so uncertainty reads as distance in depth. */
  confidence: number;
  /** 0–1 thesis relevance, kept for sorting and for the gloss. */
  fit: number;
};

/** Distance is relevance. The band is wide enough that a glance reads it. */
export const NEAR = 14, FAR = 46;

export function placement(asset: Asset, beliefs: Conviction[], state: HubState): Placement {
  const fit = relevance(asset, beliefs, state);
  return {
    angle: bearing(asset.themes, `${asset.kind}:${asset.id}`),
    radius: NEAR + (1 - fit) * (FAR - NEAR),
    confidence: Math.max(0, ...state.inferred.filter(i => asset.themes.includes(i.id)).map(i => i.confidence)),
    fit,
  };
}

/** Screen position for a placement, as percentages of the field. North is up. */
export function point(place: Placement, rotation = 0): { x: number; y: number } {
  const radians = (place.angle - 90 + rotation) * Math.PI / 180;
  return { x: 50 + Math.cos(radians) * place.radius, y: 50 + Math.sin(radians) * place.radius };
}

/** How far the field must turn to bring a theme to the top. */
export const rotationFor = (theme: string | null) => theme && theme in THEME_BEARING ? -THEME_BEARING[theme] : 0;
