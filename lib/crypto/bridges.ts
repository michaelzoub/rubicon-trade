import 'server-only';
import { address, chain, CHAIN_IDS, parseUnits } from './chains';
import { rpc, verifyTransaction, verifyUserOperation } from './rpc';
import { ownedWallet } from './wallet';
import { createUniswapBridge, bridgeRequest } from './providers/uniswap-bridge';
import { stepAction } from './bridge-steps';
import { cryptoServices } from './services';
import { tokenDecimals, checkTransactionGas } from './preflight';
import { tradePolicy } from '@/lib/socialtrading/policy';
import type { HubState, TradeIntent } from '@/lib/socialtrading/types';
import type { BridgePlan, BridgeRequest } from './bridge-types';
import type { Transaction } from './types';
const provider = createUniswapBridge();

/** Only the quote reports a fee and a duration, and every later plan read drops
 * them. Carrying them forward is what keeps the cost on screen for a whole route. */
const keepEstimate = (plan: BridgePlan, previous: BridgePlan): BridgePlan =>
  ({ ...plan, gasFeeUSD: plan.gasFeeUSD ?? previous.gasFeeUSD, timeEstimateMs: plan.timeEstimateMs ?? previous.timeEstimateMs });

/** Bounded read-only route discovery for the agent: inspect every supported
 * source, quote funded bridges, and explicitly report unavailable networks. */
export async function checkPurchaseRoutes(userId: string, input: { wallet: string; destinationChainId: number; tokenOut: string; amount: string }) {
  const wallet = address(input.wallet), tokenOut = address(input.tokenOut);
  await ownedWallet(userId, wallet); chain(input.destinationChainId);
  const amount = parseUnits(input.amount, 6);
  return Promise.all(CHAIN_IDS.map(async chainId => {
    try {
      const balance = await rpc<string>(chainId, 'eth_call', [{ to: chain(chainId).usdc, data: `0x70a08231${wallet.slice(2).padStart(64, '0')}` }, 'latest']);
      if (!/^0x[0-9a-f]+$/i.test(balance)) throw new Error('Invalid balance response.');
      if (BigInt(balance) < BigInt(amount)) return { chainId, status: 'insufficient' as const, balance: BigInt(balance).toString() };
      if (chainId === input.destinationChainId) return { chainId, status: 'same_chain' as const, balance: BigInt(balance).toString() };
      const quote = await provider.quote({ chainId, destinationChainId: input.destinationChainId, wallet, tokenIn: chain(chainId).usdc, tokenOut, amount, slippageBps: 50 });
      return { chainId, status: 'available' as const, outputAmount: quote.output.amount, gasFeeUSD: quote.gasFeeUsd, timeEstimateMs: quote.timeEstimateMs };
    } catch (error) { return { chainId, status: 'unavailable' as const, reason: error instanceof Error ? error.message : 'Route unavailable' }; }
  }));
}

export async function proposeBridge(state: HubState, userId: string, input: Record<string, unknown>) {
  const chainId = Number(input.chainId), destinationChainId = Number(input.destinationChainId);
  const tokenIn = address(input.tokenIn);
  // Buy amounts are dollars of USDC; generic swaps retain their existing path.
  if (tokenIn !== chain(chainId).usdc) throw new Error('Cross-network purchases currently pay with USDC.');
  if (typeof input.amount !== 'string') throw new Error('Enter an amount.');
  const r = bridgeRequest({ chainId, destinationChainId, tokenIn, tokenOut: address(input.tokenOut), wallet: address(input.wallet), amount: parseUnits(input.amount, 6), slippageBps: 50 });
  await ownedWallet(userId, r.wallet);
  const [plan, value, decimals, price] = await Promise.all([provider.create(r), cryptoServices.valuation.value({ chainId, address: tokenIn }, r.amount), tokenDecimals(destinationChainId, r.tokenOut), cryptoServices.defi.price({ chainId: destinationChainId, address: r.tokenOut }).catch(() => null)]);
  const at = new Date().toISOString(), policy = tradePolicy(state.profile, value, state.trades, false, Date.now(), 'user');
  const symbol = price?.symbol || 'token';
  const trade: TradeIntent = { id: crypto.randomUUID(), initiator: 'user', asset: { id: `${destinationChainId}:${r.tokenOut}`, symbol, name: `${symbol} on ${chain(destinationChainId).name}`, kind: 'crypto' }, side: 'buy', value, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, createdAt: at, reasoning: 'Cross-network purchase through Uniswap.', policy: { ...policy, at }, status: policy.allowed ? 'reserved' : policy.needsApproval ? 'approval_required' : 'blocked', crypto: { request: r, outputAmount: plan.expectedOutput, minimumOutput: '0', expiresAt: Date.now() + 60000, phase: 'ready', display: { tokenIn: { symbol: 'USDC', decimals: 6 }, tokenOut: { symbol, decimals } }, bridge: { request: r, plan } } };
  state.trades.push(trade); return trade;
}

/** Advance only one step per explicit wallet confirmation. Persist the issued
 * nonce before returning calldata; polling never signs or starts another step. */
export async function advanceBridge(state: HubState, userId: string, trade: TradeIntent, body: Record<string, unknown>) {
  const c = trade.crypto!, b = c.bridge!, r = b.request;
  await ownedWallet(userId, r.wallet);
  if (body.action === 'bridge_resume') {
    const issued = b.issued;
    if (!issued || issued.hash || issued.signature || issued.expiresAt <= Date.now()) throw new Error('Recover the transaction hash from your wallet. This request cannot be safely retried.');
    // Signing costs nothing and settles nothing, so re-offering the same request is safe.
    if (issued.typedData) return { typedData: issued.typedData, expiresAt: issued.expiresAt };
    // A user operation reserves no nonce of its own — the bundler owns ordering —
    // so it can never be safely reissued. Its hash is the only way back.
    if (!issued.transaction) throw new Error('This step was already sent to the network. Recover its transaction hash rather than signing again.');
    const nonce = await rpc<string>(issued.transaction.chainId, 'eth_getTransactionCount', [r.wallet, 'pending']);
    if (BigInt(nonce) !== BigInt(issued.transaction.nonce!)) throw new Error('A transaction is pending or confirmed. Recover its hash.');
    await checkTransactionGas(issued.transaction);
    return { transaction: issued.transaction, expiresAt: issued.expiresAt };
  }
  if (body.action === 'bridge_prepare') {
    if (b.issued || ['confirmed', 'rejected', 'blocked', 'failed'].includes(trade.status)) throw new Error('Check the existing purchase status before continuing.');
    const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator);
    if (!policy.allowed) throw new Error(policy.reason);
    if (Date.now() - Date.parse(trade.createdAt) > 24 * 3600000) throw new Error('Purchase expired. Check any completed steps before starting again.');
    b.plan = keepEstimate(await provider.get(b.plan.planId, r, true), b.plan);
    const step = b.plan.steps[b.plan.currentStepIndex];
    if (!step || step.status !== 'AWAITING_ACTION') throw new Error('Waiting for the previous step to settle.');
    const action = stepAction(step, r.wallet);
    // Fees were reserved for the source and the destination only. A step on any
    // other chain would strand money mid-route, so nothing is issued for it.
    if (action.chainId !== r.chainId && action.chainId !== r.destinationChainId) throw new Error(`This route passes through ${chain(action.chainId).name}, which this purchase did not fund. Nothing was issued.`);
    const expiresAt = Date.now() + 60000;
    if (action.kind === 'signature') {
      b.issued = { stepIndex: step.stepIndex, typedData: action.typedData, expiresAt };
      // A signature broadcasts nothing, so the purchase is not yet uncertain.
      c.phase = 'issued'; c.detail = 'Approve this route step in your wallet. It is a signature, not a transaction, and costs nothing.';
      return { typedData: action.typedData, chainId: action.chainId, expiresAt };
    }
    if (action.kind === 'batch') {
      b.issued = { stepIndex: step.stepIndex, batch: action.batch, expiresAt };
      trade.status = 'unknown'; c.phase = 'issued';
      c.detail = 'Route step awaiting your wallet signature. The network fee comes out of your USDC.';
      return { batch: action.batch, expiresAt };
    }
    const transaction: Transaction = { ...action.transaction, nonce: await rpc<string>(action.chainId, 'eth_getTransactionCount', [r.wallet, 'pending']) };
    if (!/^0x[0-9a-f]+$/i.test(transaction.nonce!)) throw new Error('Invalid transaction nonce.');
    await checkTransactionGas(transaction);
    b.issued = { stepIndex: step.stepIndex, transaction, expiresAt };
    trade.status = 'unknown'; c.phase = 'issued';
    return { transaction, expiresAt };
  }
  if (body.action === 'bridge_signed') {
    if (!b.issued?.typedData || b.issued.signature) throw new Error('No signature is awaited for this purchase.');
    if (typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) throw new Error('Invalid step signature.');
    // Persist before proving, so a failed proof call never loses the signature.
    b.issued.signature = body.signature;
    return {};
  }
  if (body.action === 'bridge_submitted') {
    if (!b.issued || b.issued.typedData || typeof body.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.hash) || b.issued.hash && b.issued.hash.toLowerCase() !== body.hash.toLowerCase()) throw new Error('Invalid or conflicting transaction hash.');
    // The batch settles inside a bundler's transaction, so its own hash is what
    // identifies the operation. Optional: a hash recovered by hand has none.
    if (b.issued.batch && body.userOpHash !== undefined) {
      if (typeof body.userOpHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(body.userOpHash) || (b.issued.userOpHash && b.issued.userOpHash !== body.userOpHash)) throw new Error('Invalid or conflicting user operation hash.');
      b.issued.userOpHash = body.userOpHash;
    }
    b.issued.hash = body.hash;
    // Persist the hash before the external proof request on the next status call.
    return {};
  }
  if (body.action !== 'bridge_status') throw new Error('Unknown bridge action.');
  if (b.issued?.signature) {
    // Nothing was broadcast, so there is no receipt to wait on: the signature
    // itself is the proof, and the plan advances the moment Uniswap accepts it.
    b.plan = keepEstimate(await provider.proof(b.plan.planId, r, b.issued.stepIndex, { signature: b.issued.signature }), b.plan);
    if (b.plan.steps[b.issued.stepIndex]?.status !== 'AWAITING_ACTION') b.issued = undefined;
  } else if (b.issued?.hash) {
    const issued = b.issued;
    const verified = issued.batch
      ? await verifyUserOperation(issued.batch, issued.userOpHash, issued.hash!)
      : await verifyTransaction(issued.transaction!, issued.hash!);
    if (verified === 'pending') return {};
    if (verified === 'reverted') { trade.status = 'failed'; c.detail = 'A route transaction reverted. Review completed steps and balances before starting another purchase.'; c.phase = 'complete'; return {}; }
    const current = await provider.get(b.plan.planId, r);
    const step = current.steps[issued.stepIndex];
    b.plan = keepEstimate(step?.status === 'COMPLETE' || step?.status === 'IN_PROGRESS' ? current : await provider.proof(b.plan.planId, r, issued.stepIndex, { txHash: issued.hash! }), b.plan);
    if (b.plan.steps[issued.stepIndex]?.status === 'COMPLETE') b.issued = undefined;
  } else if (!b.issued) b.plan = keepEstimate(await provider.get(b.plan.planId, r), b.plan);
  if (b.plan.status === 'COMPLETED') { trade.status = 'confirmed'; c.phase = 'complete'; c.outputAmount = b.plan.expectedOutput; }
  else if (b.plan.status === 'FAILED' || b.plan.steps.some(s => s.status === 'STEP_ERROR')) { trade.status = 'failed'; c.phase = 'complete'; c.detail = 'Route stopped. Funds may be held in the last completed step’s token and network.'; }
  else if (!b.issued && b.plan.status === 'AWAITING_ACTION') { trade.status = 'reserved'; c.phase = 'ready'; }
  return {};
}
