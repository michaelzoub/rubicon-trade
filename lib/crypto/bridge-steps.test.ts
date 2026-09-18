import { expect, it } from 'vitest';
import { primaryTypeOf, stepAction } from './bridge-steps';
import type { PlanStep } from './bridge-types';
import { CHAINS } from './chains';

const wallet = `0x${'11'.repeat(20)}`;
const router = `0x${'66'.repeat(20)}`;
const base = (over: Partial<PlanStep>): PlanStep => ({ stepIndex: 0, stepType: 'BRIDGE', method: 'SEND_TX', payloadType: 'TX', payload: {}, status: 'AWAITING_ACTION', tokenInChainId: 8453, ...over });

const tx = (over: Record<string, unknown> = {}) => base({ payload: { to: router, from: wallet, data: '0x095ea7b3', value: '0x00', chainId: 8453, ...over } });

it('wraps a SEND_TX step into a gasless batch on a paymaster chain', () => {
  const action = stepAction(tx(), wallet);
  expect(action.kind).toBe('batch');
  if (action.kind !== 'batch') throw new Error('expected batch');
  expect(action.batch).toMatchObject({ chainId: 8453, sender: wallet, paymaster: 'circle-usdc' });
  expect(action.batch.calls).toEqual([{ to: router, value: '0', data: '0x095ea7b3' }]);
  expect(action.batch.callData).toMatch(/^0x[0-9a-f]+$/);
});

it('converts a hex payload value into decimal base units for the call', () => {
  const action = stepAction(tx({ value: '0x0de0b6b3a7640000' }), wallet);
  if (action.kind !== 'batch') throw new Error('expected batch');
  expect(action.batch.calls[0].value).toBe('1000000000000000000');
});

it('turns a SIGN_MSG step into typed data with a derived primary type', () => {
  const action = stepAction(base({
    stepType: 'APPROVAL_PERMIT', method: 'SIGN_MSG', payloadType: 'EIP_712',
    payload: {
      domain: { name: 'Permit2', chainId: 8453, verifyingContract: `0x${'22'.repeat(20)}` },
      types: { PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }], PermitDetails: [{ name: 'token', type: 'address' }] },
      values: { details: { token: CHAINS[8453].usdc }, spender: router },
    },
  }), wallet);
  expect(action.kind).toBe('signature');
  if (action.kind !== 'signature') throw new Error('expected signature');
  expect(action.typedData.primaryType).toBe('PermitSingle');
  expect(action.chainId).toBe(8453);
});

it('derives the primary type as the one no other type references', () => {
  expect(primaryTypeOf({ PermitSingle: [{ name: 'details', type: 'PermitDetails' }], PermitDetails: [{ name: 'token', type: 'address' }] })).toBe('PermitSingle');
});

it('batches a SEND_CALLS step directly', () => {
  const action = stepAction(base({ method: 'SEND_CALLS', payloadType: 'EIP_5792', payload: { chainId: 8453, from: wallet, calls: [{ to: router, data: '0xaa', value: '0x0' }, { to: router, data: '0xbb', value: '0x1' }] } }), wallet);
  if (action.kind !== 'batch') throw new Error('expected batch');
  expect(action.batch.calls).toEqual([{ to: router, value: '0', data: '0xaa' }, { to: router, value: '1', data: '0xbb' }]);
});

it('refuses a step whose sender, target, data or chain cannot be trusted', () => {
  expect(() => stepAction(tx({ from: `0x${'99'.repeat(20)}` }), wallet)).toThrow('wallet');
  expect(() => stepAction(tx({ to: `0x${'00'.repeat(20)}` }), wallet)).toThrow('target');
  expect(() => stepAction(tx({ data: 'nothex' }), wallet)).toThrow('calldata');
  expect(() => stepAction(tx({ chainId: 999 }), wallet)).toThrow('Unsupported');
  expect(() => stepAction(base({ method: 'SEND_RAW' as PlanStep['method'], payload: { chainId: 8453 } }), wallet)).toThrow('does not yet support');
});
