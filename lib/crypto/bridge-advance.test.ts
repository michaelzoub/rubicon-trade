import { beforeEach, expect, it, vi } from 'vitest';
import type { BridgePlan, PlanStep } from './bridge-types';
import type { HubState, TradeIntent } from '@/lib/socialtrading/types';

const wallet = `0x${'11'.repeat(20)}`;
const router = `0x${'66'.repeat(20)}`;
const planState = { current: null as BridgePlan | null };
const proofCalls: { stepIndex: number; proof: { txHash?: string; signature?: string } }[] = [];

vi.mock('./wallet', () => ({ ownedWallet: vi.fn(async () => wallet) }));
vi.mock('./rpc', () => ({
  rpc: vi.fn(async () => '0x5'),
  verifyTransaction: vi.fn(async () => 'confirmed'),
  verifyUserOperation: vi.fn(async () => 'confirmed'),
}));
vi.mock('./preflight', () => ({ tokenDecimals: vi.fn(async () => 18), checkTransactionGas: vi.fn(async () => {}) }));
vi.mock('@/lib/socialtrading/policy', () => ({ tradePolicy: () => ({ allowed: true, needsApproval: false, reason: '' }) }));
vi.mock('./providers/uniswap-bridge', async importOriginal => ({
  ...(await importOriginal<typeof import('./providers/uniswap-bridge')>()),
  createUniswapBridge: () => ({
    quote: vi.fn(), create: vi.fn(),
    get: vi.fn(async () => planState.current!),
    proof: vi.fn(async (_id: string, _r: unknown, stepIndex: number, proof: { txHash?: string; signature?: string }) => {
      proofCalls.push({ stepIndex, proof });
      planState.current!.steps[stepIndex].status = 'COMPLETE';
      planState.current!.currentStepIndex = stepIndex + 1;
      const next = planState.current!.steps[stepIndex + 1];
      if (next) next.status = 'AWAITING_ACTION'; else planState.current!.status = 'COMPLETED';
      return planState.current!;
    }),
  }),
}));

const { advanceBridge } = await import('./bridges');

const permitStep: PlanStep = { stepIndex: 1, stepType: 'APPROVAL_PERMIT', method: 'SIGN_MSG', payloadType: 'EIP_712', status: 'NOT_READY', tokenInChainId: 8453, payload: { domain: { name: 'Permit2', chainId: 8453, verifyingContract: `0x${'22'.repeat(20)}` }, types: { PermitSingle: [{ name: 'details', type: 'PermitDetails' }], PermitDetails: [{ name: 'token', type: 'address' }] }, values: { details: { token: `0x${'33'.repeat(20)}` } } } };
const txStep = (stepIndex: number, status: PlanStep['status']): PlanStep => ({ stepIndex, stepType: 'BRIDGE', method: 'SEND_TX', payloadType: 'TX', status, tokenInChainId: 8453, payload: { to: router, from: wallet, data: '0x095ea7b3', value: '0x00', chainId: 8453 } });

function fixture() {
  const plan: BridgePlan = { planId: 'plan-1', swapper: wallet, recipient: wallet, status: 'AWAITING_ACTION', currentStepIndex: 0, expectedOutput: '1000', gasFeeUSD: '0.42', timeEstimateMs: 90000, steps: [txStep(0, 'AWAITING_ACTION'), permitStep, txStep(2, 'NOT_READY')] };
  planState.current = plan;
  const request = { chainId: 8453, destinationChainId: 42161, wallet, tokenIn: `0x${'33'.repeat(20)}`, tokenOut: `0x${'44'.repeat(20)}`, amount: '50000000', slippageBps: 50 };
  const trade = { id: 't1', initiator: 'user', value: 50, status: 'reserved', createdAt: new Date().toISOString(), crypto: { request, phase: 'ready', bridge: { request, plan } } } as unknown as TradeIntent;
  return { state: { profile: {}, trades: [trade] } as unknown as HubState, trade };
}

beforeEach(() => { proofCalls.length = 0; });

it('issues a sponsored user operation for a transaction step instead of demanding native gas', async () => {
  const { state, trade } = fixture();
  const result = await advanceBridge(state, 'user-1', trade, { action: 'bridge_prepare' });
  expect(result.batch).toMatchObject({ chainId: 8453, sender: wallet, paymaster: 'circle-usdc' });
  expect(result.transaction).toBeUndefined();
});

it('walks a Permit2 signature step through to the next step without any transaction', async () => {
  const { state, trade } = fixture();
  const b = trade.crypto!.bridge!;
  // Settle step 0 so the permit step becomes active.
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_prepare' });
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_submitted', hash: `0x${'ab'.repeat(32)}`, userOpHash: `0x${'cd'.repeat(32)}` });
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_status' });
  expect(b.issued).toBeUndefined();

  const prepared = await advanceBridge(state, 'user-1', trade, { action: 'bridge_prepare' });
  expect(prepared.typedData).toMatchObject({ primaryType: 'PermitSingle' });
  expect(prepared.batch).toBeUndefined();
  expect(prepared.transaction).toBeUndefined();

  const signature = `0x${'ef'.repeat(65)}`;
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_signed', signature });
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_status' });
  expect(proofCalls.at(-1)).toEqual({ stepIndex: 1, proof: { signature } });
  expect(b.plan.currentStepIndex).toBe(2);
});

it('refuses a malformed signature and never records it', async () => {
  const { state, trade } = fixture();
  trade.crypto!.bridge!.issued = { stepIndex: 1, expiresAt: Date.now() + 60000, typedData: { domain: {}, types: {}, values: {}, primaryType: 'X' } };
  await expect(advanceBridge(state, 'user-1', trade, { action: 'bridge_signed', signature: '0xdeadbeef' })).rejects.toThrow('Invalid step signature');
  expect(trade.crypto!.bridge!.issued!.signature).toBeUndefined();
});

it('never reissues a sponsored step, because a user operation reserves no nonce', async () => {
  const { state, trade } = fixture();
  await advanceBridge(state, 'user-1', trade, { action: 'bridge_prepare' });
  await expect(advanceBridge(state, 'user-1', trade, { action: 'bridge_resume' })).rejects.toThrow('Recover its transaction hash');
});

it('re-offers an unsigned signature step, which broadcasts nothing', async () => {
  const { state, trade } = fixture();
  trade.crypto!.bridge!.issued = { stepIndex: 1, expiresAt: Date.now() + 60000, typedData: { domain: { chainId: 8453 }, types: {}, values: {}, primaryType: 'PermitSingle' } };
  const resumed = await advanceBridge(state, 'user-1', trade, { action: 'bridge_resume' });
  expect(resumed.typedData).toMatchObject({ primaryType: 'PermitSingle' });
});

it('refuses a step on a chain the purchase did not fund', async () => {
  const { state, trade } = fixture();
  planState.current!.steps[0].payload.chainId = 137;
  await expect(advanceBridge(state, 'user-1', trade, { action: 'bridge_prepare' })).rejects.toThrow('Polygon, which this purchase did not fund');
  expect(trade.crypto!.bridge!.issued).toBeUndefined();
});
