import { beforeEach, expect, it, vi } from 'vitest';
import { CHAINS } from './chains';

/** The shipped default: one network, so nothing is bridged and no other chain is
 * even read. `route-resolver.test.ts` covers the cross-chain path that
 * `CROSS_CHAIN_FUNDING` can switch back on. */
const wallet = `0x${'11'.repeat(20)}`;
const balances: Record<number, bigint> = {};
const quoteFor = vi.fn();

vi.mock('./wallet', () => ({ ownedWallet: vi.fn(async () => wallet) }));
vi.mock('./rpc', () => ({ rpc: vi.fn(async (chainId: number) => `0x${(balances[chainId] ?? 0n).toString(16)}`) }));
vi.mock('./providers/uniswap-bridge', () => ({ createUniswapBridge: () => ({ quote: quoteFor }) }));

const { resolvePurchaseRoute } = await import('./route-resolver');
const reader = { gasPrice: async () => 50_000_000n, nativeUsd: async () => 2450 };
const run = (amount = '50') => resolvePurchaseRoute('u1', { wallets: [wallet], destinationChainId: 8453, tokenOut: `0x${'44'.repeat(20)}`, amount }, reader);

beforeEach(() => {
  for (const id of Object.keys(CHAINS)) balances[Number(id)] = 0n;
  quoteFor.mockReset();
});

it('buys from Base when Base is funded', async () => {
  balances[8453] = 60_000_000n;
  const { chosen } = await run();
  expect(chosen).toMatchObject({ status: 'same_chain', chainId: 8453 });
  expect(quoteFor).not.toHaveBeenCalled();
});

it('reads only Base, so money elsewhere is never quoted or bridged', async () => {
  balances[1] = 500_000_000n; balances[42161] = 500_000_000n;
  const { chosen, candidates } = await run();
  expect(chosen).toBeNull();
  expect(quoteFor).not.toHaveBeenCalled();
  expect([...new Set(candidates.map(c => c.chainId))]).toEqual([8453]);
});

it('says the Base balance is short rather than reaching for another network', async () => {
  balances[8453] = 10_000_000n; balances[1] = 900_000_000n;
  const { chosen, candidates } = await run('50');
  expect(chosen).toBeNull();
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ chainId: 8453, status: 'insufficient', balance: '10000000' });
});
