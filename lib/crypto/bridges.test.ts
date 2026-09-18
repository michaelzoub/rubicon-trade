import { beforeEach, expect, it, vi } from 'vitest';
import { createUniswapBridge, validatePlan, bridgeRequest } from './providers/uniswap-bridge';
import type { BridgePlan, BridgeRequest } from './bridge-types';
import { CHAINS } from './chains';
const wallet = `0x${'11'.repeat(20)}`;
const r: BridgeRequest = { chainId: 1, destinationChainId: 8453, wallet, tokenIn: CHAINS[1].usdc, tokenOut: `0x${'22'.repeat(20)}`, amount: '25000000', slippageBps: 50 };
const quote = () => ({ routing: 'CHAINED', quote: { swapper: wallet, tradeType: 'EXACT_INPUT', tokenInChainId: 1, tokenOutChainId: 8453, slippageTolerance: 0.5, input: { token: r.tokenIn, amount: r.amount }, output: { token: r.tokenOut, amount: '12000', recipient: wallet } } });
const plan = (): BridgePlan => ({ planId: 'plan-123', swapper: wallet, recipient: wallet, currentStepIndex: 0, expectedOutput: '12000', status: 'AWAITING_ACTION', steps: [{ stepIndex: 0, stepType: 'BRIDGE', method: 'SEND_TX', payloadType: 'TX', payload: {}, status: 'AWAITING_ACTION', tokenIn: r.tokenIn, tokenOut: r.tokenOut, tokenInChainId: 1, tokenOutChainId: 8453, tokenInAmount: r.amount }] });
beforeEach(() => { vi.stubEnv('UNISWAP_API_KEY', 'test-only'); });
it('requests cross-chain routing and creates a plan from the exact server quote', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(quote())).mockResolvedValueOnce(Response.json(plan()));
  expect((await createUniswapBridge(fetcher).create(r)).planId).toBe('plan-123');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ tokenInChainId: 1, tokenOutChainId: 8453, amount: '25000000', permitAmount: 'EXACT', slippageTolerance: .5 });
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ routing: 'CHAINED', quote: quote().quote });
});
it('rejects mismatched recipients, networks, amounts and slippage before a plan exists', async () => {
  for (const edit of [(q: ReturnType<typeof quote>) => { q.quote.output.recipient = r.tokenOut; }, (q: ReturnType<typeof quote>) => { q.quote.tokenOutChainId = 1; }, (q: ReturnType<typeof quote>) => { q.quote.input.amount = '1'; }, (q: ReturnType<typeof quote>) => { q.quote.slippageTolerance = 5; }]) {
    const q = quote(); edit(q); const fetcher = vi.fn().mockResolvedValue(Response.json(q));
    await expect(createUniswapBridge(fetcher).create(r)).rejects.toThrow('matching');
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it('never accepts incomplete steps as completed or a changed plan identity', async () => {
  const p = plan(); p.status = 'COMPLETED'; expect(() => validatePlan(p, r)).toThrow('Incomplete');
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...plan(), planId: 'other' }));
  await expect(createUniswapBridge(fetcher).get('plan-123', r)).rejects.toThrow('identity');
});
it('uses PATCH proof submission without creating or broadcasting transactions', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(plan()));
  const hash = `0x${'ab'.repeat(32)}`;
  await createUniswapBridge(fetcher).proof('plan-123', r, 0, { txHash: hash });
  expect(fetcher.mock.calls[0][0]).toContain('/plan/plan-123');
  expect(fetcher.mock.calls[0][1].method).toBe('PATCH');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ steps: [{ stepIndex: 0, proof: { txHash: hash } }] });
});

it('enables chained actions on every request, or the gateway answers 404', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(quote()));
  await createUniswapBridge(fetcher).quote(r);
  expect(fetcher.mock.calls[0][1].headers['x-chained-actions-enabled']).toBe('true');
});

it('carries the quote fee and time estimate onto the plan, which does not report them', async () => {
  const q = quote(); (q.quote as Record<string, unknown>).gasFeeUsd = '0.42'; (q.quote as Record<string, unknown>).timeEstimateMs = 120000;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json(q)).mockResolvedValueOnce(Response.json(plan()));
  const created = await createUniswapBridge(fetcher).create(r);
  expect(created.gasFeeUSD).toBe('0.42');
  expect(created.timeEstimateMs).toBe(120000);
});

it('submits a signature proof for signature steps without inventing a transaction hash', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(plan()));
  const signature = `0x${'cd'.repeat(65)}`;
  await createUniswapBridge(fetcher).proof('plan-123', r, 0, { signature });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ steps: [{ stepIndex: 0, proof: { signature } }] });
});

it('refuses a proof that carries neither a hash nor a signature', async () => {
  const fetcher = vi.fn();
  await expect(createUniswapBridge(fetcher).proof('plan-123', r, 0, {})).rejects.toThrow('proof');
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects invalid requests and missing credentials', async () => {
  expect(() => bridgeRequest({ ...r, destinationChainId: 1 })).toThrow('different');
  expect(() => bridgeRequest({ ...r, amount: '-1' })).toThrow('amount');
  vi.stubEnv('UNISWAP_API_KEY', ''); const fetcher = vi.fn();
  await expect(createUniswapBridge(fetcher).quote(r)).rejects.toThrow('not configured');
  expect(fetcher).not.toHaveBeenCalled();
});
