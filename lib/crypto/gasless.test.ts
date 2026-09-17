import { afterEach, expect, it, vi } from 'vitest';
import { recoverSwapOperation, sendSwapBatch } from './gasless';
import type { SwapBatch } from './types';
const batch: SwapBatch = { chainId:8453, sender:`0x${'11'.repeat(20)}`, calls:[], callData:'0x', paymaster:'circle-usdc' };
afterEach(() => vi.unstubAllGlobals());
it('never signs when the provider changed networks', async () => {
  const signAuthorization = vi.fn();
  const provider = {request:vi.fn(async () => '0x1')};
  await expect(sendSwapBatch({batch, provider, signAuthorization})).rejects.toThrow('Switch to Base');
  expect(signAuthorization).not.toHaveBeenCalled();
  expect(provider.request).toHaveBeenCalledTimes(1);
});
it('never signs an expired quote', async () => {
  const signAuthorization = vi.fn(), request = vi.fn();
  await expect(sendSwapBatch({batch, provider:{request}, signAuthorization, expiresAt:Date.now()-1})).rejects.toThrow('expired');
  expect(request).not.toHaveBeenCalled(); expect(signAuthorization).not.toHaveBeenCalled();
});
it('fails before signing if fee funds disappeared', async () => {
  const signAuthorization = vi.fn();
  const request = vi.fn(async ({method}: {method:string}) => method === 'eth_chainId' ? '0x2105' : method === 'eth_accounts' ? [batch.sender] : '0x0');
  await expect(sendSwapBatch({batch, provider:{request}, signAuthorization, requiredUsdc:50500000n})).rejects.toThrow('Insufficient');
  expect(signAuthorization).not.toHaveBeenCalled();
});
it('recovers a receipt by operation hash without resubmitting', async () => {
  const hash = `0x${'ab'.repeat(32)}`;
  const fetcher = vi.fn(async (_url: string, _init: {body: string}) => ({ok:true,json:async () => ({result:{receipt:{transactionHash:hash}}})}));
  vi.stubGlobal('fetch',fetcher);
  expect(await recoverSwapOperation(8453, hash)).toBe(hash);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).method).toBe('eth_getUserOperationReceipt');
});
it('leaves an operation pending until a receipt exists', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => ({ok:true,json:async () => ({result:null})})));
  expect(await recoverSwapOperation(8453,`0x${'ab'.repeat(32)}`)).toBeNull();
});
