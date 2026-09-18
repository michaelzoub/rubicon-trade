import type { SwapBatch, Transaction } from './types';
export type BridgeRequest = { chainId: number; destinationChainId: number; wallet: string; tokenIn: string; tokenOut: string; amount: string; slippageBps: number };
/** An EIP-712 request as Uniswap sends it: `values` rather than `message`, and no
 * named primary type. `lib/crypto/bridge-steps.ts` derives the primary type. */
export type TypedData = { domain: Record<string, unknown>; types: Record<string, { name: string; type: string }[]>; values: Record<string, unknown>; primaryType: string };
export type PlanStep = { stepIndex: number; stepType: string; method: string; payloadType: string; payload: Record<string, unknown>; status: 'NOT_READY' | 'AWAITING_ACTION' | 'IN_PROGRESS' | 'COMPLETE' | 'STEP_ERROR'; tokenIn?: string; tokenOut?: string; tokenInChainId?: number; tokenOutChainId?: number; tokenInAmount?: string; tokenOutAmount?: string; swapper?: string; recipient?: string; proof?: { txHash?: string; signature?: string } };
export type BridgePlan = { planId: string; swapper: string; recipient: string; status: 'ACTIVE' | 'AWAITING_ACTION' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'; currentStepIndex: number; expectedOutput: string; steps: PlanStep[]; gasFeeUSD?: string; timeEstimateMs?: number };
/** What the server authorized for one step, and how it settles.
 *
 * A step is a transaction, a sponsored user operation, or a signature — never
 * more than one. `transaction` carries a reserved EOA nonce so a lost response
 * can be retried safely; `batch` cannot, because the bundler owns ordering, so
 * a lost batch is recovered by hash exactly as `resumeSwap` requires. */
export type BridgeIssued = { stepIndex: number; expiresAt: number; transaction?: Transaction; batch?: SwapBatch; typedData?: TypedData; hash?: string; userOpHash?: string; signature?: string };
export type BridgeState = { request: BridgeRequest; plan: BridgePlan; issued?: BridgeIssued };
