import { describe, expect, it } from 'vitest';
import type { TradeIntent } from '@/lib/socialtrading/types';
import { beliefSeries } from './beliefs-graph';
const trade = (id: string, side: 'buy' | 'sell', value: number, status: TradeIntent['status'] = 'confirmed'): TradeIntent => ({ id, side, value, status, asset: { id: 'VRT', kind: 'stock', symbol: 'VRT', name: 'Vertiv' }, createdAt: `2026-09-${id.padStart(2, '0')}T12:00:00Z`, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, reasoning: 'Power infrastructure', policy: { allowed: true, reason: '', at: '' } });
describe('beliefSeries', () => {
  it('excludes uncompleted orders and subtracts completed sales in chronological order', () => {
    const result = beliefSeries([trade('3', 'sell', 40), trade('2', 'buy', 500, 'approval_required'), trade('1', 'buy', 100), trade('4', 'buy', 200, 'submitted')]);
    expect(result.keys).toEqual(['stock:VRT']);
    expect(result.points.map(p => [p.trade.id, p.values])).toEqual([['1', [100]], ['3', [60]]]);
  });
  it('keeps assets with the same symbol but different identities separate', () => {
    const other = { ...trade('2', 'buy', 20), asset: { id: 'other', symbol: 'VRT', name: 'Other asset', kind: 'crypto' as const } };
    expect(beliefSeries([trade('1', 'buy', 100), other]).points.at(-1)?.values).toEqual([100, 20]);
  });
});
