import { encodeFunctionData, parseAbi, serializeTransaction } from 'viem';
import type { Transaction } from './types';
const oracle = '0x420000000000000000000000000000000000000f';
const abi = parseAbi(['function getL1Fee(bytes) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)']);
/** OP Stack execution gas excludes L1 data and operator fees. Never treat those as zero. */
export async function extraNetworkFee(tx: Transaction, gas: bigint, read: (method: string, params: unknown[]) => Promise<unknown>): Promise<bigint> {
  if (tx.chainId !== 10 && tx.chainId !== 8453) return 0n;
  // Same upper-bound serialization approach as viem/op-stack estimateL1Fee.
  const serialized = serializeTransaction({ type: 'eip1559', chainId: tx.chainId, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value), gas: gas * 2n, maxFeePerGas: 5_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, nonce: tx.nonce ? Number(BigInt(tx.nonce)) : 1 });
  const results = await Promise.all([
    read('eth_call', [{ to: oracle, data: encodeFunctionData({ abi, functionName: 'getL1Fee', args: [serialized] }) }, 'latest']),
    read('eth_call', [{ to: oracle, data: encodeFunctionData({ abi, functionName: 'getOperatorFee', args: [gas] }) }, 'latest']),
  ]);
  if (!results.every(v => typeof v === 'string' && /^0x[0-9a-f]{64}$/i.test(v))) throw new Error('RPC network fee estimate unavailable.');
  return BigInt(results[0] as string) + BigInt(results[1] as string);
}
