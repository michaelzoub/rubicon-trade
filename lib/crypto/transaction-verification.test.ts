import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('./http', () => ({ http: mock.http }));
import { verifyTransaction } from './rpc';
const tx = { chainId: 8453, from: `0x${'11'.repeat(20)}`, to: `0x${'22'.repeat(20)}`, data: '0xaabb', value: '0', nonce: '0x7' };
const hash = `0x${'ab'.repeat(32)}`;
let sent: Record<string, string> | null, receipt: Record<string, string> | null, head: string, block: string;
beforeEach(() => {
  vi.stubEnv('CRYPTO_RPC_URL_8453', 'https://rpc.example.test');
  sent = { from: tx.from, to: tx.to, input: tx.data, value: '0x0', nonce: '0x7' };
  receipt = { status: '0x1', blockNumber: '0x10', blockHash: '0xbeef' }; head = '0x12'; block = '0xbeef';
  mock.http.mockReset().mockImplementation(async (_p, _url, options) => ({ result: ({ eth_chainId: '0x2105', eth_getTransactionByHash: sent, eth_getTransactionReceipt: receipt, eth_blockNumber: head, eth_getBlockByNumber: { hash: block } } as Record<string, unknown>)[options.body.method] }));
});
afterEach(() => vi.unstubAllEnvs());
it('requires the exact transaction, successful receipt, canonical block, and two subsequent blocks', async () => {
  expect(await verifyTransaction(tx, hash)).toBe('confirmed');
  head = '0x11'; expect(await verifyTransaction(tx, hash)).toBe('pending');
  head = '0x12'; block = '0xdead'; expect(await verifyTransaction(tx, hash)).toBe('pending');
  receipt = null; expect(await verifyTransaction(tx, hash)).toBe('pending');
  sent = null; expect(await verifyTransaction(tx, hash)).toBe('pending');
});
it.each(['from', 'to', 'input', 'value', 'nonce'])('rejects an unrelated or replayed transaction with wrong %s', async field => {
  sent![field] = field === 'value' || field === 'nonce' ? '0x99' : '0x00';
  await expect(verifyTransaction(tx, hash)).rejects.toThrow('does not match');
});
it('reports reverts, not success, and fails closed on RPC outages', async () => {
  receipt!.status = '0x0'; expect(await verifyTransaction(tx, hash)).toBe('reverted');
  mock.http.mockRejectedValueOnce(new Error('RPC unavailable')); await expect(verifyTransaction(tx, hash)).rejects.toThrow('RPC unavailable');
});
