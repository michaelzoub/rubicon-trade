import { describe, expect, it } from 'vitest';
import { PREVIEW_STATE, PREVIEW_ASSETS } from '../../app/preview/fixture';
import { captureWorldview, changeConviction, convictionsOf, relevance } from './worldview';
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
