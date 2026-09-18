import { beforeEach, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { newProfile } from '@/lib/socialtrading/profile';
import type { HubState } from '@/lib/socialtrading/types';
import { chain } from '@/lib/crypto/chains';
import { PERMIT_TYPES, ROUTERS } from '@/lib/crypto/permit';
import { PERMIT2 } from '@/lib/crypto/aa';
const db = vi.hoisted(() => ({ state: null as HubState | null, quote: vi.fn(), swap: vi.fn(), rpc: vi.fn(), verify: vi.fn(), owns: vi.fn(), saveFail: false }));
vi.mock('@/lib/socialtrading/server', async original => ({
  ...await original<typeof import('@/lib/socialtrading/server')>(),
  authenticate: async () => 'alice',
  loadState: async () => structuredClone(db.state),
  saveState: async (_id: string, s: HubState) => { if (db.saveFail) throw new Error('Persistence unavailable'); s.revision++; db.state = structuredClone(s); return s; },
}));
vi.mock('@/lib/crypto/wallet', () => ({ ownedWallet: db.owns, userWallets: async () => [] }));
vi.mock('@/lib/crypto/services', () => ({ cryptoServices: { execution: { quote: db.quote, swap: db.swap }, valuation: { value: async () => 25 }, defi: { price: async () => ({ symbol: 'token', decimals: 6 }) } } }));
vi.mock('@/lib/crypto/rpc', () => ({ rpc: db.rpc, verifyTransaction: db.verify, verifyUserOperation: db.verify }));
import { POST } from './route';
// Public test-only key: never used against a network.
const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const r = { chainId: 8453, wallet: signer.address.toLowerCase(), tokenIn: chain(8453).usdc, tokenOut: `0x${'22'.repeat(20)}`, amount: '25000000', slippageBps: 50 };
const hash = `0x${'ab'.repeat(32)}`;
const word = (n: bigint | number) => `0x${n.toString(16).padStart(64, '0')}`;
let allowance: bigint, permit: boolean;
function quote() {
  const deadline = String(Math.floor(Date.now()/1000)+1800);
  return { provider: 'uniswap', request: r, minimumOutput: '99', outputAmount: '100', expiresAt: Date.now()+60000, raw: {}, ...(permit ? { permitData: { domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, types: PERMIT_TYPES, values: { details: { token: r.tokenIn, amount: r.amount, expiration: deadline, nonce: '0' }, spender: ROUTERS[8453], sigDeadline: deadline } } } : {}) };
}
async function post(body: Record<string, unknown>) {
  const response = await POST(new Request('http://localhost/api/trade/crypto', { method: 'POST', body: JSON.stringify({ revision: db.state?.revision, ...body }) }));
  return { status: response.status, body: await response.json() };
}
const action = (action: string, extra = {}) => post({ action, tradeId: 't', ...extra });
beforeEach(() => {
  vi.clearAllMocks(); allowance = 25000000n; permit = false; db.saveFail = false;
  db.owns.mockResolvedValue(r.wallet);
  db.state = { revision: 0, profile: newProfile('alice'), trades: [{ id: 't', initiator: 'user', status: 'reserved', asset: { id: 'a', symbol: 'T', name: 'Token', kind: 'crypto' }, side: 'buy', value: 25, createdAt: new Date().toISOString(), reasoning: 'user', policy: { allowed: true, needsApproval: false, reason: 'user', at: new Date().toISOString() }, crypto: { request: r, phase: 'ready', minimumOutput: '99', outputAmount: '100', expiresAt: Date.now()+60000 } }], events: [], messages: [], dislikes: [], preferences: [], inferred: [], signals: [] } as unknown as HubState;
  db.quote.mockImplementation(async () => quote());
  db.swap.mockResolvedValue({ chainId: 8453, from: r.wallet, to: ROUTERS[8453], data: '0x1234', value: '0' });
  db.verify.mockResolvedValue('pending');
  db.rpc.mockImplementation(async (_chain, method, params) => {
    if (method === 'eth_chainId') return '0x2105';
    if (method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_getBalance') return word(10n ** 18n);
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0x1';
    if (params[0].data === '0x313ce567') return word(6);
    if (params[0].data.startsWith('0xdd62ed3e')) return word(allowance);
    // The purchase, plus the USDC Circle's Paymaster takes as the network fee.
    return word(30000000);
  });
});
it('batches approval with the swap, and never reports success before the chain does', async () => {
  allowance = 0n;
  const fresh = await action('prepare');
  // One signature, not two: prepare goes straight to the swap, with no separate
  // approval transaction for the wallet to fund and confirm first.
  expect(fresh.body.step).toBe('swap'); expect(fresh.body.transaction).toBeUndefined();
  expect(fresh.body.quoteId).toBeTruthy();
  const swap = await action('authorize', { quoteId: fresh.body.quoteId });
  expect(swap.body.step).toBe('swap');
  expect(swap.body.transaction).toBeUndefined();
  // The missing allowance is granted inside the operation, immediately before the swap consumes it.
  expect(swap.body.batch.paymaster).toBe('circle-usdc');
  expect(swap.body.batch.calls).toHaveLength(3);
  expect(swap.body.batch.calls.at(-1)).toMatchObject({ to: ROUTERS[8453], data: '0x1234' });
  expect(db.state!.trades[0].status).toBe('unknown');
  await action('submitted', { hash, userOpHash: `0x${'cd'.repeat(32)}` });
  expect(db.state!.trades[0].crypto?.userOpHash).toBe(`0x${'cd'.repeat(32)}`);
  await action('status'); expect(db.state!.trades[0].status).toBe('unknown');
  db.verify.mockResolvedValue('confirmed'); await action('status');
  expect(db.state!.trades[0].status).toBe('confirmed');
  expect(db.state!.trades[0].crypto?.history).toEqual([{ step: 'swap', hash, result: 'confirmed' }]);
});
it('verifies a real Permit2 signature against the stored fresh quote before swap creation', async () => {
  permit = true; const fresh = await action('prepare');
  expect((await action('authorize', { quoteId: fresh.body.quoteId })).status).toBe(502);
  expect(db.swap).not.toHaveBeenCalled();
  const p = fresh.body.permitData;
  const signature = await signer.signTypedData({ domain: p.domain, types: PERMIT_TYPES, primaryType: 'PermitSingle', message: p.values });
  const result = await action('authorize', { quoteId: fresh.body.quoteId, signature });
  expect(result.status).toBe(200); expect(db.swap).toHaveBeenCalledWith(expect.objectContaining({ permitData: p }), signature);
  expect((await action('authorize', { quoteId: fresh.body.quoteId, signature })).status).toBe(502);
});
it('rejects stale quotes and signatures from a superseded quote', async () => {
  const first = await action('prepare'); const second = await action('prepare');
  expect((await action('authorize', { quoteId: first.body.quoteId })).status).toBe(502);
  db.state!.trades[0].crypto!.quote!.expiresAt = Date.now()-1;
  expect((await action('authorize', { quoteId: second.body.quoteId })).status).toBe(502);
  expect(db.swap).not.toHaveBeenCalled();
});
it('does not reissue an uncertain transaction, and a reverted swap never succeeds', async () => {
  const fresh = await action('prepare'); await action('authorize', { quoteId: fresh.body.quoteId });
  expect((await action('prepare')).status).toBe(502);
  await action('submitted', { hash }); db.verify.mockResolvedValue('reverted'); await action('status');
  expect(db.state!.trades[0].status).toBe('failed'); expect(db.state!.trades[0].crypto?.phase).toBe('complete');
});
it('preserves pending state on RPC verification failure, refuses wallet ownership changes and persists before handing out calldata', async () => {
  const fresh = await action('prepare'); db.saveFail = true;
  const unsaved = await action('authorize', { quoteId: fresh.body.quoteId });
  expect(unsaved.status).toBe(502); expect(unsaved.body.transaction).toBeUndefined(); expect(unsaved.body.batch).toBeUndefined();
  db.saveFail = false; await action('authorize', { quoteId: fresh.body.quoteId }); await action('submitted', { hash });
  db.verify.mockRejectedValueOnce(new Error('RPC failed')); expect((await action('status')).status).toBe(502);
  expect(db.state!.trades[0].status).toBe('unknown');
});
it('offers no blind retry for a sponsored batch, which has no nonce to hold', async () => {
  const fresh = await action('prepare'); const issued = await action('authorize', { quoteId: fresh.body.quoteId });
  expect(issued.body.batch).toBeDefined();
  // Resending would risk a second purchase; the operation hash is the only way back.
  expect((await action('resume')).status).toBe(502);
  expect(db.swap).toHaveBeenCalledTimes(1);
  await action('submitted', { hash }); expect((await action('resume')).status).toBe(502);
});
it('refuses a changed Privy wallet owner before issuing anything', async () => {
  db.owns.mockRejectedValueOnce(new Error('Wallet no longer linked'));
  expect((await action('prepare')).status).toBe(502); expect(db.quote).not.toHaveBeenCalled();
});
it('allows a user sale into USDC on Ethereum while keeping purchases on Base', async () => {
  const sale = { ...r, chainId: 1, tokenIn: r.tokenOut, tokenOut: chain(1).usdc, amount: '1' };
  db.quote.mockImplementation(async request => ({ ...quote(), request }));
  const result = await post({ action: 'propose', ...sale });
  expect(result.status).toBe(200);
  const proposed = result.body.state.trades.at(-1);
  expect(proposed).toMatchObject({ initiator: 'user', side: 'sell', status: 'reserved', crypto: { request: { chainId: 1, tokenIn: sale.tokenIn, tokenOut: sale.tokenOut } } });
  const buy = await post({ action: 'propose', ...sale, tokenIn: chain(1).usdc, tokenOut: r.tokenOut });
  expect(buy.status).toBe(400);
});
