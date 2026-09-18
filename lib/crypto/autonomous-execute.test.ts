import { beforeEach, expect, it, vi } from 'vitest';
import type { HubState, TradeIntent } from '@/lib/socialtrading/types';
import type { SwapBatch } from './types';

/** Does the agent API actually act on a user's behalf?
 *
 * Everything below `executeAutonomousBuy` is real: the policy check, the
 * Base-only rule, the prepare → authorize → send sequence, and the rule that
 * only a verified receipt confirms a purchase. The two doubles are the places a
 * real Privy session signer would sit — the enclave signature and the bundler —
 * because neither can exist in a test.
 *
 * What this therefore proves: given a delegated wallet, the agent path does
 * drive a purchase to a confirmed state, and refuses in every case it should.
 * What it does not prove: that Privy's signatures are accepted onchain. */

const WALLET = { id: 'kq-wallet-1', address: `0x${'11'.repeat(20)}` };
const BATCH: SwapBatch = { chainId: 8453, sender: WALLET.address, calls: [{ to: `0x${'66'.repeat(20)}`, value: '0', data: '0xabcd' }], callData: '0xdeadbeef', paymaster: 'circle-usdc' };

const signed: string[] = [];
const sent = vi.fn(async () => ({ userOpHash: `0x${'cd'.repeat(32)}`, hash: `0x${'ab'.repeat(32)}` }));
let verifyResult: 'confirmed' | 'reverted' | 'pending' = 'confirmed';
let prepared: Record<string, unknown> = { quoteId: 'q1', expiresAt: Date.now() + 60_000, permitData: { domain: { name: 'Permit2' }, types: { PermitSingle: [] }, values: { spender: `0x${'66'.repeat(20)}` } } };
let authorized: Record<string, unknown> = { batch: BATCH, expiresAt: Date.now() + 60_000 };

vi.mock('./autosign', () => ({
  autoSigningConfigured: () => true,
  // Where Privy's enclave would sign. Records what it was asked for.
  delegatedProvider: () => ({ request: async ({ method }: { method: string }) => { signed.push(method); return `0x${'ee'.repeat(65)}`; } }),
  delegatedAuthorization: () => async () => ({ r: `0x${'11'.repeat(32)}`, s: `0x${'22'.repeat(32)}`, yParity: 0, address: WALLET.address, chainId: 8453, nonce: 7 }),
}));
vi.mock('./gasless', () => ({ sendSwapBatch: (args: unknown) => sent(args as never) }));
vi.mock('./rpc', () => ({ verifyUserOperation: async () => verifyResult }));
vi.mock('./trades', () => ({
  prepareSwap: async () => prepared,
  authorizeSwap: async () => authorized,
}));
vi.mock('@/lib/socialtrading/policy', () => ({ tradePolicy: () => ({ allowed: true, needsApproval: false, reason: '' }) }));
vi.mock('@/lib/socialtrading/personalization', () => ({ recordEvent: vi.fn() }));

const { executeAutonomousBuy } = await import('./autonomous');

const trade = (over: Partial<TradeIntent> = {}): TradeIntent => ({
  id: 't1', initiator: 'agent', value: 25, status: 'reserved', createdAt: new Date().toISOString(),
  asset: { id: '8453:0xb2', symbol: 'NVDAc', name: 'NVIDIA', kind: 'stock' },
  crypto: { request: { chainId: 8453, wallet: WALLET.address, tokenIn: `0x${'aa'.repeat(20)}`, tokenOut: `0x${'b2'.repeat(20)}`, amount: '25000000', slippageBps: 50 }, outputAmount: '1', minimumOutput: '1', expiresAt: Date.now() + 60_000, phase: 'ready' },
  ...over,
} as unknown as TradeIntent);

const state = (patch: Partial<HubState['profile']> = {}): HubState => ({
  profile: { userId: 'u1', permission: 'automatic', autoExecute: true, limits: { perTrade: '100', daily: '250', weekly: '1000' }, ...patch },
  trades: [],
} as unknown as HubState);

beforeEach(() => {
  signed.length = 0; sent.mockClear(); verifyResult = 'confirmed';
  prepared = { quoteId: 'q1', expiresAt: Date.now() + 60_000, permitData: { domain: { name: 'Permit2' }, types: { PermitSingle: [] }, values: { spender: `0x${'66'.repeat(20)}` } } };
  authorized = { batch: BATCH, expiresAt: Date.now() + 60_000 };
});

it('buys on the user’s behalf and only confirms on a verified receipt', async () => {
  const t = trade();
  const result = await executeAutonomousBuy(state(), 'u1', t, WALLET);

  // Signed the Permit2 authorization through the delegated signer, then sent
  // the sponsored batch — the same two steps the browser performs.
  expect(signed).toEqual(['eth_signTypedData_v4']);
  expect(sent).toHaveBeenCalledTimes(1);
  expect(sent.mock.calls[0][0]).toMatchObject({ batch: BATCH });

  expect(result.status).toBe('confirmed');
  expect(t.status).toBe('confirmed');
  expect(t.crypto!.hash).toBe(`0x${'ab'.repeat(32)}`);
  expect(t.crypto!.history).toEqual([{ step: 'swap', hash: `0x${'ab'.repeat(32)}`, result: 'confirmed' }]);
});

it('records a revert as a failure rather than a purchase', async () => {
  verifyResult = 'reverted';
  const t = trade();
  await executeAutonomousBuy(state(), 'u1', t, WALLET);
  expect(t.status).toBe('failed');
  expect(t.crypto!.detail).toContain('Nothing was bought');
});

it('leaves an unconfirmed operation uncertain instead of claiming success', async () => {
  verifyResult = 'pending';
  const t = trade();
  const result = await executeAutonomousBuy(state(), 'u1', t, WALLET);
  expect(result.status).toBe('unknown');
  expect(t.status).toBe('unknown');
  expect(t.crypto!.history).toBeUndefined();
});

it('refuses without the grant, and never signs anything', async () => {
  await expect(executeAutonomousBuy(state({ autoExecute: false }), 'u1', trade(), WALLET)).rejects.toThrow('off');
  expect(signed).toEqual([]);
  expect(sent).not.toHaveBeenCalled();
});

it('refuses a purchase over the per-trade limit before signing', async () => {
  await expect(executeAutonomousBuy(state({ limits: { perTrade: '10', daily: '250', weekly: '1000' } }), 'u1', trade(), WALLET)).rejects.toThrow('per-trade limit');
  expect(sent).not.toHaveBeenCalled();
});

it('refuses any network but Base, even with everything else granted', async () => {
  const t = trade();
  t.crypto!.request.chainId = 42161;
  await expect(executeAutonomousBuy(state(), 'u1', t, WALLET)).rejects.toThrow('Base');
  expect(sent).not.toHaveBeenCalled();
});

it('refuses a proposal belonging to a different wallet than the delegated one', async () => {
  const t = trade();
  t.crypto!.request.wallet = `0x${'99'.repeat(20)}`;
  await expect(executeAutonomousBuy(state(), 'u1', t, WALLET)).rejects.toThrow('different wallet');
  expect(sent).not.toHaveBeenCalled();
});

it('stops rather than half-finishing when the purchase needs a separate approval', async () => {
  // An approval transaction means no sponsored batch was available; that needs
  // native gas and a person, so nothing is signed.
  prepared = { transaction: { chainId: 8453, from: WALLET.address, to: `0x${'66'.repeat(20)}`, data: '0x', value: '0' }, expiresAt: Date.now() + 60_000 };
  await expect(executeAutonomousBuy(state(), 'u1', trade(), WALLET)).rejects.toThrow('only you can sign');
  expect(sent).not.toHaveBeenCalled();
});

it('refuses to spend when no sponsored batch was authorized', async () => {
  authorized = { transaction: { chainId: 8453 }, expiresAt: Date.now() + 60_000 };
  await expect(executeAutonomousBuy(state(), 'u1', trade(), WALLET)).rejects.toThrow('sponsored operation');
  expect(sent).not.toHaveBeenCalled();
});
