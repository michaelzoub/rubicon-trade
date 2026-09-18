import 'server-only';
import { address, chain, NATIVE } from '../chains';
import { ProviderError } from '../http';
import type { BridgePlan, BridgeRequest } from '../bridge-types';

export function bridgeRequest(r: BridgeRequest): BridgeRequest {
  chain(r.chainId); chain(r.destinationChainId);
  if (r.chainId === r.destinationChainId) throw new Error('Choose different source and destination networks.');
  if (typeof r.amount !== 'string' || !/^[1-9][0-9]{0,77}$/.test(r.amount) || BigInt(r.amount) >= 2n ** 256n) throw new Error('Invalid bridge amount.');
  if (!Number.isInteger(r.slippageBps) || r.slippageBps < 1 || r.slippageBps > 100) throw new Error('Invalid slippage.');
  const wallet = address(r.wallet);
  if (wallet === NATIVE) throw new Error('Choose a wallet.');
  return { ...r, wallet, tokenIn: address(r.tokenIn), tokenOut: address(r.tokenOut) };
}
export function validatePlan(plan: BridgePlan, r: BridgeRequest): BridgePlan {
  if (!plan || !/^[\w-]{1,150}$/.test(plan.planId) || address(plan.swapper) !== r.wallet || address(plan.recipient) !== r.wallet || !Array.isArray(plan.steps) || !plan.steps.length || plan.steps.length > 20 || !/^[1-9][0-9]{0,77}$/.test(plan.expectedOutput)) throw new Error('Invalid Uniswap execution plan.');
  if (!['ACTIVE', 'AWAITING_ACTION', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(plan.status)) throw new Error('Invalid plan status.');
  for (const [index, step] of plan.steps.entries()) {
    if (step.stepIndex !== index || !['NOT_READY', 'AWAITING_ACTION', 'IN_PROGRESS', 'COMPLETE', 'STEP_ERROR'].includes(step.status)) throw new Error('Invalid plan steps.');
    if (step.swapper && address(step.swapper) !== r.wallet || step.recipient && address(step.recipient) !== r.wallet) throw new Error('Plan wallet changed.');
    if (step.tokenInChainId !== undefined) chain(step.tokenInChainId);
    if (step.tokenOutChainId !== undefined) chain(step.tokenOutChainId);
  }
  const first = plan.steps[0], last = plan.steps.at(-1)!;
  if (first.tokenInChainId !== r.chainId || address(first.tokenIn) !== r.tokenIn || first.tokenInAmount !== r.amount || last.tokenOutChainId !== r.destinationChainId || address(last.tokenOut) !== r.tokenOut) throw new Error('Plan does not match the purchase.');
  if (plan.status === 'COMPLETED' && plan.steps.some(s => s.status !== 'COMPLETE')) throw new Error('Incomplete plan cannot be settled.');
  if (plan.steps.filter(s => s.status === 'AWAITING_ACTION').length > 1) throw new Error('Ambiguous active step.');
  return plan;
}
export function createUniswapBridge(fetcher: typeof fetch = fetch) {
  async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const key = process.env.UNISWAP_API_KEY;
    if (!key) throw new ProviderError('Uniswap', 503);
    let response: Response;
    // Without `x-chained-actions-enabled` the gateway answers 404 "No quotes
    // available" to every cross-chain quote, so no route can ever be found.
    try { response = await fetcher(`https://trade-api.gateway.uniswap.org/v1/${path}`, { method, headers: { 'x-api-key': key, 'content-type': 'application/json', 'x-chained-actions-enabled': 'true', 'x-agent-info': JSON.stringify({ decision_origin: 'human_mediated', integration_name: 'rubicon-trade' }) }, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw new ProviderError('Uniswap', 504); }
    if (!response.ok) throw new ProviderError('Uniswap', response.status);
    return response.json();
  }
  return {
    async quote(input: BridgeRequest) {
      const r = bridgeRequest(input);
      const response = await call<{ routing: string; quote: Record<string, unknown> & { gasFeeUsd?: string; timeEstimateMs?: number; swapper: string; tradeType: string; tokenInChainId: number; tokenOutChainId: number; slippageTolerance?: number; input: { token: string; amount: string }; output: { token: string; amount: string; recipient: string } } }>('quote', 'POST', { type: 'EXACT_INPUT', tokenIn: r.tokenIn, tokenOut: r.tokenOut, tokenInChainId: r.chainId, tokenOutChainId: r.destinationChainId, swapper: r.wallet, recipient: r.wallet, amount: r.amount, permitAmount: 'EXACT', slippageTolerance: r.slippageBps / 100 });
      const q = response.quote;
      if (response.routing !== 'CHAINED' || !q || q.tradeType !== 'EXACT_INPUT' || address(q.swapper) !== r.wallet || q.tokenInChainId !== r.chainId || q.tokenOutChainId !== r.destinationChainId || address(q.input?.token) !== r.tokenIn || q.input.amount !== r.amount || address(q.output?.token) !== r.tokenOut || address(q.output.recipient) !== r.wallet || !/^[1-9][0-9]{0,77}$/.test(q.output.amount) || q.slippageTolerance !== r.slippageBps / 100) throw new Error('No matching cross-chain route is available.');
      return q;
    },
    /** The plan reports neither a fee nor a duration — only the quote does, and it
     * spells the fee `gasFeeUsd`. Carrying both forward is what lets the card show
     * a cost and a wait instead of silently rendering nothing. */
    async create(r: BridgeRequest) {
      const quote = await this.quote(r);
      const plan = validatePlan(await call<BridgePlan>('plan', 'POST', { routing: 'CHAINED', quote }), r);
      return { ...plan, gasFeeUSD: quote.gasFeeUsd ?? plan.gasFeeUSD, timeEstimateMs: quote.timeEstimateMs ?? plan.timeEstimateMs };
    },
    async get(id: string, r: BridgeRequest, refresh = false) { const plan = validatePlan(await call<BridgePlan>(`plan/${encodeURIComponent(id)}${refresh ? '?forceRefresh=true' : ''}`), r); if (plan.planId !== id) throw new Error('Plan identity changed.'); return plan; },
    /** A signature step settles with a signature and never has a transaction hash,
     * so demanding one here is what dead-ends every route at its Permit2 step. */
    async proof(id: string, r: BridgeRequest, stepIndex: number, proof: { txHash?: string; signature?: string }) {
      const { txHash, signature } = proof;
      if (txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('Invalid transaction hash.');
      if (signature !== undefined && !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Invalid step signature.');
      if (!txHash && !signature) throw new Error('A step proof needs a transaction hash or a signature.');
      const plan = validatePlan(await call<BridgePlan>(`plan/${encodeURIComponent(id)}`, 'PATCH', { steps: [{ stepIndex, proof: txHash ? { txHash } : { signature } }] }), r);
      if (plan.planId !== id) throw new Error('Plan identity changed.'); return plan;
    },
  };
}
