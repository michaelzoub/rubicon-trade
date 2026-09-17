import { beforeEach, expect, it, vi } from 'vitest';
import { assertWallet, sendPurchaseTransaction, signPurchasePermit } from './purchase-client';
import { PERMIT_TYPES, ROUTERS } from './permit';
import { PERMIT2 } from './aa';
const r = { chainId: 8453, wallet: `0x${'11'.repeat(20)}`, tokenIn: `0x${'22'.repeat(20)}`, tokenOut: `0x${'33'.repeat(20)}`, amount: '25000000', slippageBps: 50 };
const tx = { chainId: r.chainId, from: r.wallet, to: ROUTERS[r.chainId], data: '0x1234', value: '0', nonce: '0x7' };
const hash = `0x${'ab'.repeat(32)}`;
let network: string, accounts: string[], native: string, nonce: string;
const provider = { request: vi.fn() };
beforeEach(() => {
  nonce = '0x7'; network = '0x2105'; accounts = [r.wallet]; native = '0xde0b6b3a7640000';
  provider.request.mockReset().mockImplementation(async ({ method }) => {
    if (method === 'eth_getTransactionCount') return nonce;
    if (method === 'eth_call') return `0x${'0'.repeat(64)}`;
    if (method === 'eth_chainId') return network;
    if (method === 'eth_accounts') return accounts;
    if (method === 'eth_getBalance') return native;
    if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_gasPrice') return '0x3b9aca00';
    if (method === 'eth_sendTransaction') return hash;
    if (method === 'eth_signTypedData_v4') return `0x${'ab'.repeat(65)}`;
    throw new Error(`unexpected ${method}`);
  });
});
it('broadcasts via the selected Privy provider with explicit account and chain, returning only a hash', async () => {
  expect(await sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).toBe(hash);
  expect(provider.request).toHaveBeenCalledWith({ method: 'eth_sendTransaction', params: [expect.objectContaining({ from: r.wallet, chainId: '0x2105', to: tx.to })] });
});
it('never silently switches wallet or network', async () => {
  network = '0x1'; await expect(assertWallet(provider, r)).rejects.toThrow('Switch to Base');
  network = '0x2105'; accounts = [r.tokenIn, r.wallet]; await expect(assertWallet(provider, r)).rejects.toThrow('active account changed');
  expect(provider.request.mock.calls.some(([a]) => a.method.startsWith('wallet_'))).toBe(false);
});
it('blocks expired quotes and zero native gas before sending', async () => {
  await expect(sendPurchaseTransaction(provider, r, tx, Date.now()-1)).rejects.toThrow('expired');
  native = '0x0'; await expect(sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).rejects.toThrow('Insufficient native gas');
  expect(provider.request.mock.calls.some(([a]) => a.method === 'eth_sendTransaction')).toBe(false);
});
it('propagates rejected signatures and RPC failures without inventing a hash', async () => {
  const original = provider.request.getMockImplementation()!;
  provider.request.mockImplementation(async a => { if (a.method === 'eth_sendTransaction') throw Object.assign(new Error('User rejected'), { code: 4001 }); return original(a); });
  await expect(sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).rejects.toThrow('User rejected');
  provider.request.mockRejectedValueOnce(new Error('RPC unavailable'));
  await expect(sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).rejects.toThrow('RPC unavailable');
});
it('rechecks wallet after gas estimation and after Permit2 signing', async () => {
  const original = provider.request.getMockImplementation()!;
  provider.request.mockImplementation(async a => { const result = await original(a); if (a.method === 'eth_estimateGas') network = '0x1'; return result; });
  await expect(sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).rejects.toThrow('Switch to Base');
  network = '0x2105';
  provider.request.mockImplementation(async a => { const result = await original(a); if (a.method === 'eth_signTypedData_v4') accounts = [r.tokenIn]; return result; });
  const now = Math.floor(Date.now()/1000);
  await expect(signPurchasePermit(provider, r, { domain: { name: 'Permit2', chainId: 8453, verifyingContract: PERMIT2 }, types: PERMIT_TYPES, values: { details: { token: r.tokenIn, amount: r.amount, expiration: String(now+1800), nonce: '0' }, spender: ROUTERS[8453], sigDeadline: String(now+1800) } }, Date.now()+60000)).rejects.toThrow('active account changed');
});

it('does not broadcast with a changed nonce or substitute a new transaction', async () => {
  nonce = '0x8';
  await expect(sendPurchaseTransaction(provider, r, tx, Date.now()+60000)).rejects.toThrow('pending or confirmed');
  expect(provider.request.mock.calls.some(([a]) => a.method === 'eth_sendTransaction')).toBe(false);
});
