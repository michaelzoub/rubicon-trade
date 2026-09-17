import { beforeEach, expect, it, vi } from 'vitest';
import { chain } from './chains';
import { erc20ApproveData, PERMIT2 } from './aa';
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./rpc', () => ({ rpc: mock.rpc }));
import { preflight, approvalTransaction, checkTransactionGas } from './preflight';
const r = { chainId: 8453, wallet: `0x${'11'.repeat(20)}`, tokenIn: chain(8453).usdc, tokenOut: `0x${'22'.repeat(20)}`, amount: '25000000', slippageBps: 50 };
const word = (n: bigint | number) => `0x${n.toString(16).padStart(64, '0')}`;
let usdc = 25000000n, native = 1000000000000000000n, allowance = 0n, decimals = 6;
beforeEach(() => {
  usdc = 25000000n; native = 1000000000000000000n; allowance = 0n; decimals = 6;
  mock.rpc.mockReset().mockImplementation(async (_chain, method, params) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getBalance') return word(native);
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0x3b9aca00';
    if (params[0].data === '0x313ce567') return word(params[0].to === r.tokenIn ? decimals : 18);
    if (params[0].data.startsWith('0xdd62ed3e')) return word(allowance);
    return word(usdc);
  });
});
it('reads exact chain balances and onchain decimals', async () => {
  expect(await preflight(r)).toMatchObject({ inputDecimals: 6, outputDecimals: 18 });
  expect(mock.rpc.mock.calls.every(c => c[0] === 8453)).toBe(true);
});
it('blocks insufficient USDC even when the wallet has funds elsewhere', async () => {
  usdc = 24999999n;
  await expect(preflight(r)).rejects.toThrow(/Insufficient USDC on Base/);
});
it('blocks zero native gas before approval or signing', async () => {
  native = 0n; await expect(preflight(r)).rejects.toThrow(/Add ETH.*Base/);
});
it('fails closed on RPC failures, wrong RPC chain, and USDC decimal mismatch', async () => {
  mock.rpc.mockRejectedValueOnce(new Error('RPC failure')); await expect(preflight(r)).rejects.toThrow('RPC failure');
  mock.rpc.mockResolvedValueOnce('0x1'); await expect(preflight(r)).rejects.toThrow('RPC network mismatch');
  decimals = 18; await expect(preflight(r)).rejects.toThrow('USDC decimals mismatch');
});
it('approves only the exact amount, skips sufficient allowance, and clears partial allowance first', async () => {
  expect(await approvalTransaction(r)).toMatchObject({ to: r.tokenIn, data: erc20ApproveData(PERMIT2, 25000000n), value: '0' });
  allowance = 25000000n; expect(await approvalTransaction(r)).toBeNull();
  allowance = 1n; expect(await approvalTransaction(r)).toMatchObject({ data: erc20ApproveData(PERMIT2, 0n) });
});
it('simulates and blocks insufficient estimated gas before issuing the transaction', async () => {
  const tx = (await approvalTransaction(r))!;
  await expect(checkTransactionGas(tx)).resolves.toBeUndefined();
  native = 100n; await expect(checkTransactionGas(tx)).rejects.toThrow(/Insufficient native gas/);
  mock.rpc.mockRejectedValueOnce(new Error('execution reverted')); await expect(checkTransactionGas(tx)).rejects.toThrow('execution reverted');
});
