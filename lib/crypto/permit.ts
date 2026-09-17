import { address } from './chains';
import { PERMIT2 } from './aa';
import type { PermitData, SwapRequest } from './types';

// UniversalRouterV2 from Uniswap/universal-router deploy-addresses, paired with API header 2.0.
export const ROUTERS: Record<number, string> = {
  1: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
  8453: '0x6ff5693b99212da76ad316178a184ab56d299b43',
  42161: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
  10: '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
  137: '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
};
export const PERMIT_TYPES = {
  PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }],
  PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }],
};
export function validatePermit(p: PermitData, r: SwapRequest) {
  const now = Math.floor(Date.now() / 1000);
  if (p.domain?.name !== 'Permit2' || Number(p.domain.chainId) !== r.chainId || address(p.domain.verifyingContract) !== PERMIT2 ||
      address(p.values?.details?.token) !== r.tokenIn || BigInt(p.values.details.amount) !== BigInt(r.amount) || address(p.values.spender) !== ROUTERS[r.chainId] ||
      Number(p.values.sigDeadline) <= now || Number(p.values.sigDeadline) > now + 3600 || Number(p.values.details.expiration) <= now || Number(p.values.details.expiration) > now + 31 * 86400)
    throw new Error('Permit2 authorization does not match this purchase or has expired.');
  for (const value of [p.values.sigDeadline, p.values.details.expiration, p.values.details.nonce]) if (!/^[0-9]+$/.test(String(value))) throw new Error('Invalid Permit2 numeric field.');
  // Never sign arbitrary types supplied by a remote response.
  for (const [key, value] of Object.entries(PERMIT_TYPES)) if (JSON.stringify(p.types[key]) !== JSON.stringify(value)) throw new Error('Unsupported Permit2 signing types.');
  if (Object.keys(p.types).some(k => !['PermitSingle', 'PermitDetails', 'EIP712Domain'].includes(k))) throw new Error('Unsupported Permit2 signing types.');
}
export function permitPayload(p: PermitData) {
  return { domain: { name: p.domain.name, chainId: Number(p.domain.chainId), verifyingContract: p.domain.verifyingContract as `0x${string}` }, types: { ...PERMIT_TYPES, EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }] }, primaryType: 'PermitSingle' as const, message: p.values }; 
}
