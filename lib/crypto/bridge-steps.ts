import 'server-only';
import { address, chain, gaslessChain, NATIVE } from './chains';
import { encodeAccountCalls } from './aa';
import type { Call, SwapBatch, Transaction } from './types';
import type { PlanStep, TypedData } from './bridge-types';

/** Exactly one thing the wallet is asked to do for one plan step.
 *
 * A route is a state machine, and every step is one of three shapes. Uniswap's
 * own plans put a Permit2 signature at step 1 of 5, so treating `SEND_TX` as the
 * only shape strands a route after its first approval has already been paid for
 * onchain — which is why this mapping is exhaustive rather than incremental. */
export type StepAction =
  | { kind: 'batch'; batch: SwapBatch; chainId: number }
  | { kind: 'transaction'; transaction: Transaction; chainId: number }
  | { kind: 'signature'; typedData: TypedData; chainId: number };

/** EIP-712 wants the primary type named, and Uniswap's payload does not name it.
 * It is the one type no other type references as a field. */
export function primaryTypeOf(types: Record<string, { name: string; type: string }[]>): string {
  const names = Object.keys(types).filter(name => name !== 'EIP712Domain');
  if (!names.length) throw new Error('This route step is missing its signature types.');
  const referenced = new Set(names.flatMap(name => types[name].map(field => field.type.replace(/\[\d*\]$/, ''))));
  const roots = names.filter(name => !referenced.has(name));
  if (roots.length !== 1) throw new Error('This route step has an ambiguous signature type.');
  return roots[0];
}

/** Base units as a decimal string. Uniswap sends `"0x00"`; `Call.value` is decimal. */
function callValue(value: unknown): string {
  if (value === undefined || value === null) return '0';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Invalid route transaction value.');
  const text = String(value);
  if (!/^(0x[0-9a-fA-F]+|\d+)$/.test(text)) throw new Error('Invalid route transaction value.');
  return BigInt(text).toString();
}

function toCall(raw: Record<string, unknown>, wallet: string): Call {
  const to = address(raw.to);
  if (to === NATIVE) throw new Error('This route step has an invalid target.');
  if (raw.from !== undefined && address(raw.from) !== wallet) throw new Error('This route step would send from a different wallet.');
  if (typeof raw.data !== 'string' || !/^0x(?:[a-fA-F0-9]{2})*$/.test(raw.data)) throw new Error('This route step has malformed calldata.');
  return { to, value: callValue(raw.value), data: raw.data };
}

function batchOf(chainId: number, wallet: string, calls: Call[]): StepAction {
  if (!calls.length) throw new Error('This route step has nothing to execute.');
  // A chain without a paymaster falls back to native gas rather than failing, so
  // adding a chain never silently breaks a route. Every chain here is sponsored.
  if (!gaslessChain(chainId)) {
    const [only] = calls;
    if (calls.length > 1) throw new Error(`Batched route steps are not available on ${chain(chainId).name}.`);
    return { kind: 'transaction', chainId, transaction: { chainId, from: wallet, to: only.to, data: only.data, value: only.value } };
  }
  return { kind: 'batch', chainId, batch: { chainId, sender: wallet, calls, callData: encodeAccountCalls(calls), paymaster: 'circle-usdc' } };
}

/** Validate one plan step and turn it into a wallet action. Nothing here trusts
 * the provider: the chain must be supported, the sender must still be the user's
 * wallet, and the calldata must be well formed before any of it reaches a wallet. */
export function stepAction(step: PlanStep, wallet: string): StepAction {
  const owner = address(wallet);
  if (step.swapper && address(step.swapper) !== owner) throw new Error('This route step changed wallets.');

  if (step.method === 'SIGN_MSG' && step.payloadType === 'EIP_712') {
    const payload = step.payload as { domain?: Record<string, unknown>; types?: Record<string, { name: string; type: string }[]>; values?: Record<string, unknown> };
    const { domain, types, values } = payload;
    if (!domain || !types || !values || typeof values !== 'object') throw new Error('This route step has an incomplete signature request.');
    const chainId = Number(domain.chainId ?? step.tokenInChainId);
    chain(chainId);
    if (domain.verifyingContract !== undefined) address(domain.verifyingContract);
    return { kind: 'signature', chainId, typedData: { domain: { ...domain, chainId }, types, values, primaryType: primaryTypeOf(types) } };
  }

  if (step.method === 'SEND_TX' && step.payloadType === 'TX') {
    const payload = step.payload as Record<string, unknown>;
    const chainId = Number(payload.chainId ?? step.tokenInChainId);
    chain(chainId);
    return batchOf(chainId, owner, [toCall(payload, owner)]);
  }

  if (step.method === 'SEND_CALLS' && step.payloadType === 'EIP_5792') {
    const payload = step.payload as { chainId?: unknown; from?: unknown; calls?: unknown };
    const chainId = Number(payload.chainId ?? step.tokenInChainId);
    chain(chainId);
    if (payload.from !== undefined && address(payload.from) !== owner) throw new Error('This route step would send from a different wallet.');
    if (!Array.isArray(payload.calls) || payload.calls.length > 10) throw new Error('This route step has an unusable batch.');
    return batchOf(chainId, owner, payload.calls.map(call => toCall(call as Record<string, unknown>, owner)));
  }

  throw new Error('This route requires a wallet action Rubicon does not yet support. No new transaction was issued.');
}
