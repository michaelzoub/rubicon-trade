import { describe, expect, it, vi } from 'vitest';
import { readPurchaseBalance, purchaseShortfall, purchaseTotal, feeCap, purchaseError } from './readiness';
import { cheaperChains, feeReserveUsd } from './chains';
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
  it('uses the chain USDC contract and counts the USDC the paymaster will take', async () => {
    const p = provider(); const funds = await readPurchaseBalance(p, wallet, 8453);
    // A wallet with no ETH at all is the case sponsorship exists for.
    expect(funds.native).toBe(0n);
    expect(feeCap(8453)).toBe(500000n);
    // The reserve used to be fictitious, because gas came out of ETH. Now Circle's
    // Paymaster really does pull it, so a buy that spends the whole balance is
    // short — and has to say so here rather than at the wallet prompt.
    expect(purchaseShortfall({...funds, usdc: 50000000n}, '50')).toBe(true);
    expect(purchaseShortfall({...funds, usdc: 50000000n + feeCap(8453) - 1n}, '50')).toBe(true);
    expect(purchaseShortfall({...funds, usdc: 50000000n + feeCap(8453)}, '50')).toBe(false);
    expect(purchaseTotal(8453, '50')).toBe(50000000n + feeCap(8453));
    expect(p.request).toHaveBeenCalledWith(expect.objectContaining({method:'eth_call', params:expect.arrayContaining([expect.objectContaining({to:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'})])}));
  });
  it('prices the fee per chain, so a small mainnet buy is not mistaken for a Base one', () => {
    // Ethereum gas is worth real money; the rollups are worth cents. A reserve
    // read off the wrong chain is what made a $0.20 buy ask for the wrong number.
    expect(feeReserveUsd(1)).toBe(8);
    expect(purchaseTotal(1, '0.2')).toBe(200000n + feeCap(1));
    expect(purchaseTotal(8453, '0.2')).toBe(200000n + feeCap(8453));
    expect(purchaseTotal(1, '0.2')).not.toBe(purchaseTotal(8453, '0.2'));
    // 3.34 USDC covers the purchase many times over and still cannot cover mainnet gas.
    const mainnet = { wallet, chainId: 1, usdc: 3340000n, native: 0n };
    expect(purchaseShortfall(mainnet, '0.2')).toBe(true);
    // The very same wallet and amount is fine on a rollup.
    expect(purchaseShortfall({ ...mainnet, chainId: 8453 }, '0.2')).toBe(false);
    // And there is somewhere cheaper to send them.
    expect(cheaperChains(1).map(c => c.name)).toContain('Base');
    expect(cheaperChains(1)[0].feeUsd).toBeLessThan(feeReserveUsd(1) * 2);
    expect(cheaperChains(137)).toEqual([]);
  });
  it('rejects chain changes during reads and malformed balances', async () => {
    const p = provider(); p.request.mockResolvedValueOnce('0x2105').mockResolvedValueOnce([wallet]).mockResolvedValueOnce('0x0').mockResolvedValueOnce('0x0').mockResolvedValueOnce('0x1');
    await expect(readPurchaseBalance(p, wallet, 8453)).rejects.toThrow('Switch to Base');
    const bad = provider(); bad.request.mockImplementation(async ({method}) => method === 'eth_chainId' ? '0x2105' : method === 'eth_accounts' ? [wallet] : 'oops');
    await expect(readPurchaseBalance(bad, wallet, 8453)).rejects.toThrow('unavailable');
  });
  it('does not expose raw node failures', () => {
    expect(purchaseError(new Error('Purchase simulation failed. Request a fresh quote.'))).toContain('Purchase simulation failed');
    expect(purchaseError(new Error('Uniswap request failed (500).'))).toContain('Uniswap');
    expect(purchaseError(new Error('RPC internal error secret'))).not.toContain('RPC');
    expect(purchaseError(new Error('4001 rejected'))).toContain('declined');
    expect(purchaseError(new Error('quote expired'))).toContain('fresh quote');
  });
});
