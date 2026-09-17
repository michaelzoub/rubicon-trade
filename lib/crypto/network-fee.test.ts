import { expect, it, vi } from 'vitest';
import { extraNetworkFee } from './network-fee';
const tx = { chainId: 8453, from: `0x${'11'.repeat(20)}`, to: `0x${'22'.repeat(20)}`, data: '0xaabb', value: '0' };
it('includes L1 data and operator fees on Base/Optimism and fails closed on oracle errors', async () => {
  const read = vi.fn().mockResolvedValueOnce(`0x${(1000).toString(16).padStart(64, '0')}`).mockResolvedValueOnce(`0x${(500).toString(16).padStart(64, '0')}`);
  expect(await extraNetworkFee(tx, 100000n, read)).toBe(1500n);
  read.mockResolvedValue('0x'); await expect(extraNetworkFee({ ...tx, chainId: 10 }, 100000n, read)).rejects.toThrow('unavailable');
  read.mockClear(); expect(await extraNetworkFee({ ...tx, chainId: 1 }, 100000n, read)).toBe(0n); expect(read).not.toHaveBeenCalled();
});
