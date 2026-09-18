import { expect, it, vi } from 'vitest';
import { liveFeeReserve, FLOOR, OP_GAS, SAFETY } from './fee-reserve';
import { feeCap } from './chains';

const reader = (gwei: number, usd: number) => ({
  gasPrice: vi.fn(async () => BigInt(Math.round(gwei * 1e9))),
  nativeUsd: vi.fn(async () => usd),
});

it('reserves cents on Ethereum when Ethereum costs cents', async () => {
  // The conditions that made an $8 reserve reasonable are long gone.
  const reserve = await liveFeeReserve(1, reader(0.05, 2450));
  expect(Number(reserve) / 1e6).toBeLessThan(0.5);
  expect(reserve).toBeGreaterThan(FLOOR);
});

it('still reserves properly when gas is genuinely expensive', async () => {
  const reserve = await liveFeeReserve(1, reader(40, 2450));
  const expected = (Number(OP_GAS) * 40e9 / 1e18) * 2450 * SAFETY;
  expect(Number(reserve) / 1e6).toBeCloseTo(Math.min(expected, Number(feeCap(1)) / 1e6), 2);
});

it('never reserves below the floor or above the signed allowance cap', async () => {
  expect(await liveFeeReserve(8453, reader(0.000001, 2450))).toBe(FLOOR);
  expect(await liveFeeReserve(1, reader(5000, 9000))).toBe(feeCap(1));
});

it('falls back to the static cap when pricing fails, rather than under-reserving', async () => {
  // A reverted purchase is worse than a refused one.
  expect(await liveFeeReserve(8453, { gasPrice: vi.fn(async () => 1n), nativeUsd: vi.fn(async () => { throw new Error('offline'); }) })).toBe(feeCap(8453));
  expect(await liveFeeReserve(8453, { gasPrice: vi.fn(async () => { throw new Error('rpc down'); }), nativeUsd: vi.fn(async () => 2450) })).toBe(feeCap(8453));
});

it('prices Polygon in its own native token, not ether', async () => {
  // POL is worth cents, so 275 gwei is still a fraction of a cent.
  const reserve = await liveFeeReserve(137, reader(275, 0.126));
  expect(Number(reserve) / 1e6).toBeLessThan(Number(feeCap(137)) / 1e6);
});

it('makes a two dollar purchase from Ethereum possible at current gas', async () => {
  const reserve = await liveFeeReserve(1, reader(0.05, 2450));
  const amount = 2_000_000n; // $2 of USDC
  expect(amount - reserve).toBeGreaterThan(1_500_000n);
});
