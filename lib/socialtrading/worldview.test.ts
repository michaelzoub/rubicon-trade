import { describe, expect, it } from 'vitest';
import { PREVIEW_STATE, PREVIEW_ASSETS } from '../../app/preview/fixture';
import { NEAR, FAR, THEME_BEARING, bearing, captureWorldview, changeConviction, convictionsOf, placement, point, relevance, rotationFor } from './worldview';
import type { Asset } from './types';
describe('living worldview', () => {
  it('preserves immutable before/after memories and exposes edits to the agent thesis', () => {
    const state = structuredClone(PREVIEW_STATE);
    const before = convictionsOf(state)[0];
    changeConviction(state, { ...before, strength: .2 });
    expect(state.worldview!.memories[0].convictions[0].strength).toBe(.75);
    expect(convictionsOf(state).find(c => c.id === before.id)?.strength).toBe(.2);
    expect(state.profile.thesis).toContain(before.text);
    changeConviction(state, { ...before, strength: 0, remove: true });
    expect(convictionsOf(state).some(c => c.id === before.id)).toBe(false);
    expect(state.worldview!.memories[1].convictions.some(c => c.id === before.id)).toBe(true);
  });
  it('moves dismissed assets away and recovers relevance when watched again', () => {
    const state = structuredClone(PREVIEW_STATE), asset = Object.values(PREVIEW_ASSETS)[0];
    const beliefs = convictionsOf(state);
    state.signals.push({ id:'reject', at:'2026-09-16', target:asset.symbol, action:'dismissed' });
    expect(relevance(asset, beliefs, state)).toBe(.06);
    state.signals.push({ id:'watch', at:'2026-09-17', target:asset.symbol, action:'watched' });
    expect(relevance(asset, beliefs, state)).toBeGreaterThan(.06);
  });
  it('records new learning without recording routine saves', () => {
    const state = structuredClone(PREVIEW_STATE);
    captureWorldview(state);
    state.profile.updatedAt = new Date().toISOString();
    captureWorldview(state);
    expect(state.worldview!.memories).toHaveLength(1);
    state.inferred[0].confidence = .91;
    captureWorldview(state);
    expect(state.worldview!.memories).toHaveLength(2);
  });
  it('keeps removed inferences out of the worldview', () => {
    const state = structuredClone(PREVIEW_STATE), belief = convictionsOf(state).find(c => c.id.startsWith('learned-'))!;
    changeConviction(state, { ...belief, remove: true });
    expect(convictionsOf(state).some(c => c.id === belief.id)).toBe(false);
  });
  it('rejects invalid conviction strength without changing state', () => {
    const state = structuredClone(PREVIEW_STATE), before = structuredClone(state);
    expect(() => changeConviction(state, {id:'bad', text:'AI', strength:NaN})).toThrow();
    expect(state).toEqual(before);
  });
});

describe('spatial market', () => {
  const state = () => structuredClone(PREVIEW_STATE);
  const asset = (over: Partial<Asset> = {}): Asset => ({
    id: 'x', kind: 'stock', symbol: 'X', name: 'X', price: 1, change: 0, chart: [], themes: [], news: [], ...over,
  } as Asset);

  it('gives every theme its own permanent direction', () => {
    const bearings = Object.values(THEME_BEARING);
    expect(new Set(bearings).size).toBe(bearings.length);
    expect(THEME_BEARING.energy).toBe(0);
  });

  it('places an asset on its theme, and between themes when it spans two', () => {
    expect(bearing(['energy'])).toBe(0);
    expect(bearing(['crypto'])).toBe(180);
    expect(bearing(['energy', 'tech'])).toBeCloseTo(30);
  });

  it('gives an unclassified asset a home of its own that never moves', () => {
    const first = bearing([], 'stock:ZZZ');
    expect(first).toBe(bearing([], 'stock:ZZZ'));
    expect(first).not.toBe(bearing([], 'stock:AAA'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(360);
  });

  it('falls back to a real direction when two themes cancel out', () => {
    expect(bearing(['energy', 'crypto'])).toBe(THEME_BEARING.energy);
  });

  it('brings what matters close and pushes what does not away', () => {
    const base = state();
    const beliefs = convictionsOf(base);
    const connected = placement(asset({ themes: base.profile.themes.slice(0, 1) }), beliefs, base);
    const stranger = placement(asset({ id: 'y', symbol: 'Y', themes: [] }), beliefs, base);
    expect(connected.radius).toBeLessThan(stranger.radius);
    expect(connected.radius).toBeGreaterThanOrEqual(NEAR);
    expect(stranger.radius).toBeLessThanOrEqual(FAR);
  });

  it('puts north at the top and turns the field to face a theme', () => {
    const north = point({ angle: 0, radius: 20, confidence: 0, fit: 0 });
    expect(north.x).toBeCloseTo(50);
    expect(north.y).toBeCloseTo(30);
    expect(rotationFor('crypto')).toBe(-180);
    expect(rotationFor(null)).toBe(0);
    const turned = point({ angle: THEME_BEARING.crypto, radius: 20, confidence: 0, fit: 0 }, rotationFor('crypto'));
    expect(turned.y).toBeCloseTo(30);
  });
});
