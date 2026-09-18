import { extraNetworkFee } from './network-fee';
import { chain } from './chains';
import type { SwapRequest, Transaction, PermitData } from './types';
import type { TypedData } from './bridge-types';
import type { WalletProvider } from './gasless';
import { permitPayload, validatePermit } from './permit';

/** Never switches accounts/networks. The selected Privy provider is the only signer. */
export async function assertWallet(provider: WalletProvider, r: SwapRequest, expiresAt?: number) {
  if (expiresAt && Date.now() >= expiresAt) throw new Error('Quote expired. Request a fresh quote.');
  if (Number(await provider.request({ method: 'eth_chainId' })) !== r.chainId) throw new Error(`Switch to ${chain(r.chainId).name} in your wallet, then continue. No network was changed.`);
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || accounts[0].toLowerCase() !== r.wallet.toLowerCase()) throw new Error('Reconnect the selected wallet before continuing. The active account changed.');
}
export async function signPurchasePermit(provider: WalletProvider, r: SwapRequest, permit: PermitData, expiresAt: number) {
  validatePermit(permit, r);
  await assertWallet(provider, r, expiresAt);
  const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [r.wallet, JSON.stringify(permitPayload(permit))] });
  await assertWallet(provider, r, expiresAt);
  if (typeof signature !== 'string') throw new Error('No Permit2 signature returned.');
  return signature;
}
export async function sendPurchaseTransaction(provider: WalletProvider, r: SwapRequest, tx: Transaction, expiresAt: number) {
  if (tx.chainId !== r.chainId || tx.from.toLowerCase() !== r.wallet.toLowerCase()) throw new Error('Purchase context changed. Reconnect the selected wallet.');
  await assertWallet(provider, r, expiresAt);
  const call = { from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}` };
  const [gas, price, balance] = await Promise.all([
    provider.request({ method: 'eth_estimateGas', params: [call] }),
    provider.request({ method: 'eth_gasPrice' }),
    provider.request({ method: 'eth_getBalance', params: [r.wallet, 'latest'] }),
  ]);
  if (![gas, price, balance].every(v => typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v))) throw new Error('RPC gas estimate unavailable.');
  if (BigInt(gas as string) <= 0n || BigInt(price as string) <= 0n) throw new Error('RPC gas estimate unavailable.');
  const extra = await extraNetworkFee(tx, BigInt(gas as string), (method, params) => provider.request({ method, params }));
  if (BigInt(balance as string) < BigInt(tx.value) + (BigInt(gas as string) * BigInt(price as string) + extra) * 2n) throw new Error(`Insufficient native gas. Add ${chain(r.chainId).nativeSymbol} to ${r.wallet} on ${chain(r.chainId).name}.`);
  await assertWallet(provider, r, expiresAt);
  if (tx.nonce !== undefined) {
    const nonce = await provider.request({ method: 'eth_getTransactionCount', params: [r.wallet, 'pending'] });
    if (typeof nonce !== 'string' || BigInt(nonce) !== BigInt(tx.nonce)) throw new Error('A wallet transaction is pending or confirmed. Recover its hash before continuing.');
    await assertWallet(provider, r, expiresAt);
  }
  // Explicit chainId binds the wallet request even if its network changes while the prompt is open.
  const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ ...call, chainId: `0x${r.chainId.toString(16)}`, ...(tx.nonce !== undefined ? { nonce: tx.nonce } : {}) }] });
  if (typeof hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Wallet returned no transaction hash. Check the wallet before retrying.');
  // Persist a broadcast hash even if the wallet switched after submitting.
  return hash;
}

/** Signs one route step's EIP-712 request.
 *
 * `eth_signTypedData_v4` wants JSON with `EIP712Domain` spelled out and the
 * payload under `message`; Uniswap sends `values` and names no primary type.
 * Nothing is broadcast and no gas is spent, so this step cannot strand funds. */
export async function signStepTypedData(provider: WalletProvider, wallet: string, chainId: number, typed: TypedData, expiresAt?: number) {
  const assert = async () => {
    if (expiresAt && Date.now() >= expiresAt) throw new Error('The step expired. Check the purchase status.');
    if (Number(await provider.request({ method: 'eth_chainId' })) !== chainId) throw new Error(`Switch to ${chain(chainId).name} in your wallet, then continue. No network was changed.`);
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !accounts.some(a => typeof a === 'string' && a.toLowerCase() === wallet.toLowerCase())) throw new Error('Reconnect the selected wallet before continuing. The active account changed.');
  };
  await assert();
  const domainTypes = [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address'], ['salt', 'bytes32']]
    .filter(([key]) => typed.domain[key] !== undefined).map(([name, type]) => ({ name, type }));
  const payload = JSON.stringify({ domain: typed.domain, types: { EIP712Domain: domainTypes, ...typed.types }, primaryType: typed.primaryType, message: typed.values },
    (_k, v) => typeof v === 'bigint' ? v.toString() : v);
  const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [wallet, payload] });
  await assert();
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Your wallet returned no usable signature for this step.');
  return signature;
}
