import { expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeFunctionResult, parseAbi } from 'viem';
import { CHAINS } from './chains';

const wallet = `0x${'11'.repeat(20)}`;
vi.mock('./wallet', () => ({ ownedWallet: vi.fn(async () => wallet) }));
const call = vi.fn();
vi.mock('./rpc', () => ({ rpc: (...args: unknown[]) => call(...args) }));

const { findHoldings, transferCall, candidates, MULTICALL3 } = await import('./recovery');
const erc20 = parseAbi(['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

/** One multicall answer per chain: balance, symbol and decimals per token. */
const answer = (rows: { balance: bigint; symbol: string; decimals: number }[]) =>
  encodeAbiParameters([{ type: 'tuple[]', components: [{ name: 'success', type: 'bool' }, { name: 'returnData', type: 'bytes' }] }],
    [rows.flatMap(r => [
      { success: true, returnData: encodeFunctionResult({ abi: erc20, functionName: 'balanceOf', result: r.balance }) },
      { success: true, returnData: encodeFunctionResult({ abi: erc20, functionName: 'symbol', result: r.symbol }) },
      { success: true, returnData: encodeFunctionResult({ abi: erc20, functionName: 'decimals', result: r.decimals }) },
    ])]);

it('finds USDC stranded on a network and names it first', async () => {
  call.mockImplementation(async (chainId: number, _m: string, params: [{ to: string }]) => {
    expect(params[0].to).toBe(MULTICALL3);
    const tokens = candidates(chainId);
    return answer(tokens.map(t => ({ balance: chainId === 1 && t === CHAINS[1].usdc ? 4_250_000n : 0n, symbol: 'USDC', decimals: 6 })));
  });
  const held = await findHoldings('u1', [wallet]);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({ chainId: 1, chainName: 'Ethereum', kind: 'usdc', display: '4.25', decimals: 6 });
});

it('reports nothing for an empty wallet rather than inventing dust', async () => {
  call.mockImplementation(async (chainId: number) => answer(candidates(chainId).map(() => ({ balance: 0n, symbol: 'X', decimals: 18 }))));
  expect(await findHoldings('u1', [wallet])).toEqual([]);
});

it('keeps the other networks when one chain is unreachable', async () => {
  call.mockImplementation(async (chainId: number) => {
    if (chainId === 8453) throw new Error('RPC down');
    const tokens = candidates(chainId);
    return answer(tokens.map(t => ({ balance: chainId === 137 && t === CHAINS[137].usdc ? 1_000_000n : 0n, symbol: 'USDC', decimals: 6 })));
  });
  const held = await findHoldings('u1', [wallet]);
  expect(held.map(h => h.chainName)).toEqual(['Polygon']);
});

it('always looks for USDC on every network, which is what actually goes astray', () => {
  for (const id of Object.keys(CHAINS).map(Number)) expect(candidates(id)).toContain(CHAINS[id as keyof typeof CHAINS].usdc);
});

it('builds a transfer the user signs, and refuses one that would burn the tokens', () => {
  const to = `0x${'22'.repeat(20)}`;
  const tx = transferCall(CHAINS[8453].usdc, to, '1000000');
  expect(tx.to).toBe(CHAINS[8453].usdc);
  expect(tx.value).toBe('0');
  expect(tx.data.startsWith('0xa9059cbb')).toBe(true);
  expect(tx.data).toContain('22'.repeat(20));
  expect(() => transferCall(CHAINS[8453].usdc, `0x${'00'.repeat(20)}`, '1')).toThrow('burn');
  expect(() => transferCall(CHAINS[8453].usdc, to, '0')).toThrow('greater than zero');
});
