import { beforeEach, expect, it, vi } from 'vitest';
import { CHAINS } from './chains';
import { OP_GAS, SAFETY } from './fee-reserve';

const wallet = `0x${'11'.repeat(20)}`;
const balances: Record<number, bigint> = {};
const quoteFor = vi.fn();

vi.mock('./wallet', () => ({ ownedWallet: vi.fn(async () => wallet) }));
vi.mock('./rpc', () => ({ rpc: vi.fn(async (chainId: number) => `0x${(balances[chainId] ?? 0n).toString(16)}`) }));
vi.mock('./providers/uniswap-bridge', () => ({ createUniswapBridge: () => ({ quote: quoteFor }) }));
/** Cross-chain funding is off by default (see `CROSS_CHAIN_FUNDING`). The route
 * logic still ships and is one flag from live, so it stays covered here with the
 * flag forced on; `route-resolver.single-chain.test.ts` covers the shipped
 * default of one network. */
vi.mock('./tradable', async importOriginal => ({
  ...(await importOriginal<typeof import('./tradable')>()),
  CROSS_CHAIN_FUNDING: true,
  FUNDING_CHAINS: Object.keys(CHAINS).map(Number),
}));

const { resolvePurchaseRoute, bridgeInput } = await import('./route-resolver');

// Gas as it actually is right now: fractions of a gwei everywhere that matters.
const GWEI = 50_000_000n, ETH_USD = 2450;
const reader = { gasPrice: async () => GWEI, nativeUsd: async (chainId: number) => chainId === 137 ? 0.126 : ETH_USD };
// The same arithmetic the reserve does, so the expectation moves with the rule
// rather than pinning a number that hides a change in it.
const RESERVE = BigInt(Math.ceil((Number(OP_GAS * GWEI) / 1e18) * ETH_USD * SAFETY * 1e6));
const run = (amount = '50') => resolvePurchaseRoute('u1', { wallets: [wallet], destinationChainId: 42161, tokenOut: `0x${'44'.repeat(20)}`, amount }, reader);

beforeEach(() => {
  for (const id of Object.keys(CHAINS)) balances[Number(id)] = 0n;
  quoteFor.mockReset();
  quoteFor.mockImplementation(async ({ chainId }: { chainId: number }) => ({ output: { amount: '1000' }, gasFeeUsd: chainId === 8453 ? '0.01' : '0.50', timeEstimateMs: 60000 }));
});

it('prefers a funded destination chain and never quotes a bridge for it', async () => {
  balances[42161] = 60_000_000n; balances[8453] = 60_000_000n;
  const { chosen } = await run();
  expect(chosen).toMatchObject({ status: 'same_chain', chainId: 42161 });
  expect(quoteFor).not.toHaveBeenCalled();
});

it('requires the fee on top at the destination, because there is nowhere to take it from', async () => {
  balances[42161] = 50_000_000n; // exactly the amount, nothing for the fee
  const { candidates } = await run();
  expect(candidates.find(c => c.chainId === 42161)).toMatchObject({ status: 'insufficient' });
});

it('reserves what the chain charges today, not a constant written years ago', async () => {
  balances[1] = 20_000_000n;
  const { candidates } = await resolvePurchaseRoute('u1', { wallets: [wallet], destinationChainId: 42161, tokenOut: `0x${'44'.repeat(20)}`, amount: '2' }, reader);
  const ethereum = candidates.find(c => c.chainId === 1)!;
  // The old static cap was $16, which refused this outright.
  expect(Number(ethereum.reserve) / 1e6).toBeLessThan(1);
  expect(ethereum.status).toBe('available');
});

it('lets a source wallet holding exactly the purchase price complete a buy', async () => {
  balances[8453] = 50_000_000n;
  const { chosen } = await run();
  expect(chosen).toMatchObject({ status: 'available', chainId: 8453, input: (50_000_000n - RESERVE).toString() });
});

it('picks the cheapest fee, then the fastest, then the lowest chain id', async () => {
  balances[8453] = 60_000_000n; balances[10] = 60_000_000n; balances[137] = 60_000_000n;
  expect((await run()).chosen).toMatchObject({ chainId: 8453 });

  quoteFor.mockImplementation(async ({ chainId }: { chainId: number }) => ({ output: { amount: '1' }, gasFeeUsd: '0.10', timeEstimateMs: chainId === 137 ? 1000 : 90000 }));
  expect((await run()).chosen).toMatchObject({ chainId: 137 });

  quoteFor.mockImplementation(async () => ({ output: { amount: '1' }, gasFeeUsd: '0.10', timeEstimateMs: 1000 }));
  expect((await run()).chosen).toMatchObject({ chainId: 10 });
});

it('does not quote a route that would deliver less than a dollar, and says so', async () => {
  // Gas spiking to a level where a tiny buy really cannot pay for itself.
  balances[1] = 20_000_000n;
  const expensive = { gasPrice: async () => 60_000_000_000n, nativeUsd: async () => 2450 };
  const { chosen, candidates } = await resolvePurchaseRoute('u1', { wallets: [wallet], destinationChainId: 42161, tokenOut: `0x${'44'.repeat(20)}`, amount: '1' }, expensive);
  expect(chosen).toBeNull();
  expect(candidates.find(c => c.chainId === 1)).toMatchObject({ status: 'fee_exceeds_amount' });
  expect(quoteFor).not.toHaveBeenCalled();
});

it('keeps the other candidates when one chain fails', async () => {
  balances[8453] = 60_000_000n; balances[10] = 60_000_000n;
  quoteFor.mockImplementation(async ({ chainId }: { chainId: number }) => {
    if (chainId === 8453) throw new Error('Uniswap request failed (500).');
    return { output: { amount: '1000' }, gasFeeUsd: '0.50', timeEstimateMs: 60000 };
  });
  const { chosen, candidates } = await run();
  expect(chosen).toMatchObject({ status: 'available', chainId: 10 });
  expect(candidates.find(c => c.chainId === 8453)).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('500') });
});

it('reserves exactly one fee from the input', () => {
  expect(bridgeInput(50_000_000n, RESERVE)).toBe(50_000_000n - RESERVE);
});
