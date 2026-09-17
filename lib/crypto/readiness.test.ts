import { describe, expect, it, vi } from 'vitest';
import { readPurchaseBalance, purchaseShortfall, feeCap, purchaseError } from './readiness';
const wallet = `0x${'11'.repeat(20)}`;
function provider(chain = '0x2105', accounts = [wallet]) {
  return { request: vi.fn(async ({method}: {method: string}) => method === 'eth_chainId' ? chain : method === 'eth_accounts' ? accounts : method === 'eth_call' ? '0x3028f20' : '0x0') };
}
describe('purchase readiness', () => {
  it('refuses Ethereum funds for a Base purchase without switching or signing', async () => {
    const p = provider('0x1');
    await expect(readPurchaseBalance(p, wallet, 8453)).rejects.toThrow('Switch to Base');
    expect(p.request.mock.calls.map(([a]) => a.method)).toEqual(['eth_chainId']);
  });
  it('requires the exact selected wallet', async () => {
    await expect(readPurchaseBalance(provider('0x2105', []), wallet, 8453)).rejects.toThrow('Reconnect');
  });
  it('uses the chain USDC contract and does not charge a fictitious USDC gas reserve', async () => {
    const p = provider(); const funds = await readPurchaseBalance(p, wallet, 8453);
    expect(funds.native).toBe(0n);
    expect(feeCap(8453)).toBe(500000n);
    expect(purchaseShortfall({...funds, usdc: 49999999n}, '50')).toBe(true);
    expect(purchaseShortfall({...funds, usdc: 50000000n}, '50')).toBe(false);
    expect(p.request).toHaveBeenCalledWith(expect.objectContaining({method:'eth_call', params:expect.arrayContaining([expect.objectContaining({to:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'})])}));
  });
  it('rejects chain changes during reads and malformed balances', async () => {
    const p = provider(); p.request.mockResolvedValueOnce('0x2105').mockResolvedValueOnce([wallet]).mockResolvedValueOnce('0x0').mockResolvedValueOnce('0x0').mockResolvedValueOnce('0x1');
    await expect(readPurchaseBalance(p, wallet, 8453)).rejects.toThrow('Switch to Base');
    const bad = provider(); bad.request.mockImplementation(async ({method}) => method === 'eth_chainId' ? '0x2105' : method === 'eth_accounts' ? [wallet] : 'oops');
    await expect(readPurchaseBalance(bad, wallet, 8453)).rejects.toThrow('unavailable');
  });
  it('does not expose raw node failures', () => {
    expect(purchaseError(new Error('RPC internal error secret'))).not.toContain('RPC');
    expect(purchaseError(new Error('4001 rejected'))).toContain('declined');
    expect(purchaseError(new Error('quote expired'))).toContain('fresh quote');
  });
});
