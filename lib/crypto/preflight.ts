import 'server-only';
import { chain, NATIVE } from './chains';
import { rpc } from './rpc';
import { erc20AllowanceData, erc20ApproveData, PERMIT2 } from './aa';
import type { SwapRequest, Transaction } from './types';

export async function tokenDecimals(chainId: number, token: string): Promise<number> {
  if (token === NATIVE) return 18;
  const result = await rpc<string>(chainId, 'eth_call', [{ to: token, data: '0x313ce567' }, 'latest']);
  if (!/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('Token decimals could not be verified on this chain.');
  const decimals = Number(BigInt(result));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error('Unsupported token decimals.');
  if (token === chain(chainId).usdc && decimals !== 6) throw new Error('USDC decimals mismatch on this chain.');
  return decimals;
}

export async function preflight(r: SwapRequest) {
  const net = chain(r.chainId);
  if (BigInt(await rpc<string>(r.chainId, 'eth_chainId', [])) !== BigInt(r.chainId)) throw new Error('RPC network mismatch.');
  const [inputDecimals, outputDecimals, native, balance, usdc] = await Promise.all([
    tokenDecimals(r.chainId, r.tokenIn), tokenDecimals(r.chainId, r.tokenOut),
    rpc<string>(r.chainId, 'eth_getBalance', [r.wallet, 'latest']),
    r.tokenIn === NATIVE ? rpc<string>(r.chainId, 'eth_getBalance', [r.wallet, 'latest']) : rpc<string>(r.chainId, 'eth_call', [{ to: r.tokenIn, data: `0x70a08231${r.wallet.slice(2).padStart(64, '0')}` }, 'latest']),
    rpc<string>(r.chainId, 'eth_call', [{ to: net.usdc, data: `0x70a08231${r.wallet.slice(2).padStart(64, '0')}` }, 'latest']),
  ]);
  for (const value of [native, balance, usdc]) if (!/^0x[0-9a-f]+$/i.test(value)) throw new Error('RPC returned an invalid balance.');
  if (BigInt(balance) < BigInt(r.amount)) throw new Error(`Insufficient ${r.tokenIn === net.usdc ? 'USDC' : 'input token'} on ${net.name} for ${r.wallet}. Funds on another chain cannot pay for this purchase.`);
  if (BigInt(native) <= (r.tokenIn === NATIVE ? BigInt(r.amount) : 0n)) throw new Error(`Insufficient native gas. Add ${net.nativeSymbol} to ${r.wallet} on ${net.name}; gas sponsorship is not enabled.`);
  return { inputDecimals, outputDecimals, native, usdc };
}

/** Issue only the necessary bounded ERC20 allowance, clearing it first for tokens such as USDT. */
export async function approvalTransaction(r: SwapRequest): Promise<Transaction | null> {
  if (r.tokenIn === NATIVE) return null;
  const result = await rpc<string>(r.chainId, 'eth_call', [{ to: r.tokenIn, data: erc20AllowanceData(r.wallet, PERMIT2) }, 'latest']);
  if (!/^0x[0-9a-f]{64}$/i.test(result)) throw new Error('RPC returned an invalid token allowance.');
  const allowance = BigInt(result);
  if (allowance >= BigInt(r.amount)) return null;
  return { chainId: r.chainId, from: r.wallet, to: r.tokenIn, value: '0', data: erc20ApproveData(PERMIT2, allowance > 0n ? 0n : BigInt(r.amount)) };
}

/** Simulate before issuing calldata, and reserve a conservative fee buffer. Rechecked by the wallet before sending. */
export async function checkTransactionGas(tx: Transaction): Promise<void> {
  const call = { from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}` };
  const [gas, price, balance] = await Promise.all([
    rpc<string>(tx.chainId, 'eth_estimateGas', [call]),
    rpc<string>(tx.chainId, 'eth_gasPrice', []),
    rpc<string>(tx.chainId, 'eth_getBalance', [tx.from, 'latest']),
  ]);
  if (BigInt(gas) <= 0n || BigInt(price) <= 0n) throw new Error('RPC gas estimate unavailable.');
  if (BigInt(balance) < BigInt(tx.value) + BigInt(gas) * BigInt(price) * 2n) throw new Error(`Insufficient native gas. Add ${chain(tx.chainId).nativeSymbol} to ${tx.from} on ${chain(tx.chainId).name} before signing.`);
}
