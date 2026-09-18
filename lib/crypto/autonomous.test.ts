import { expect, it, vi } from 'vitest';
import { autonomyState, canBuyUnattended } from './autonomous';
import type { HubState } from '@/lib/socialtrading/types';

vi.mock('./autosign', () => ({ autoSigningConfigured: () => true, delegatedProvider: vi.fn(), delegatedAuthorization: vi.fn() }));

const state = (patch: Partial<HubState['profile']> = {}): HubState => ({
  profile: { userId: 'u1', permission: 'automatic', autoExecute: true, limits: { perTrade: '100', daily: '250', weekly: '1000' }, ...patch },
  trades: [],
} as unknown as HubState);

it('needs every one of the four grants, and defaults to none of them', () => {
  expect(canBuyUnattended(state(), 'w1')).toBe(true);
  // Each one alone is enough to stop it.
  expect(autonomyState(state({ autoExecute: false }), 'w1')).toMatchObject({ allowed: false, reason: expect.stringContaining('off') });
  expect(autonomyState(state({ permission: 'approve' }), 'w1')).toMatchObject({ allowed: false, reason: expect.stringContaining('Act mode') });
  expect(autonomyState(state({ limits: { perTrade: '', daily: '', weekly: '' } }), 'w1')).toMatchObject({ allowed: false, reason: expect.stringContaining('limit') });
  expect(autonomyState(state(), null)).toMatchObject({ allowed: false, reason: expect.stringContaining('delegated') });
});

it('treats a missing flag as off rather than as consent', () => {
  expect(canBuyUnattended(state({ autoExecute: undefined }), 'w1')).toBe(false);
});

it('does not read Act mode as permission to spend', () => {
  // Act mode means "reserve without asking", which is not the same thing.
  expect(canBuyUnattended(state({ permission: 'automatic', autoExecute: false }), 'w1')).toBe(false);
});

it('requires a user signature for sales even when unattended buying is enabled', async () => {
  const { executeAutonomousBuy } = await import('./autonomous');
  const trade = { side: 'sell', crypto: { request: { chainId: 8453 } } } as import('@/lib/socialtrading/types').TradeIntent;
  await expect(executeAutonomousBuy(state(), 'u1', trade, { id: 'w1', address: `0x${'11'.repeat(20)}` })).rejects.toThrow('does not authorize sales');
});
