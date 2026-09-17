import { chain, feeCap, gaslessChain, parseUnits } from './chains';
import type { WalletProvider } from './gasless';

export type PurchaseBalance = { wallet: string; chainId: number; usdc: bigint; native: bigint };
export { feeCap };
/** Read-only: never asks a wallet to switch networks or expose more accounts. */
export async function readPurchaseBalance(provider: WalletProvider, wallet: string, chainId: number): Promise<PurchaseBalance> {
  const check = async () => {
    if (Number(await provider.request({ method: 'eth_chainId' })) !== chainId) throw new Error(`Switch to ${chain(chainId).name} to check funds. Funds on other networks cannot pay for this purchase.`);
    const accounts = await provider.request({ method: 'eth_accounts' });
    if (!Array.isArray(accounts) || !accounts.some(a => typeof a === 'string' && a.toLowerCase() === wallet.toLowerCase())) throw new Error('Reconnect the selected wallet before continuing.');
  };
  await check();
  const [usdc, native] = await Promise.all([
    provider.request({ method: 'eth_call', params: [{ to: chain(chainId).usdc, data: `0x70a08231${wallet.slice(2).padStart(64, '0')}` }, 'latest'] }),
    provider.request({ method: 'eth_getBalance', params: [wallet, 'latest'] }),
  ]);
  await check();
  if (![usdc, native].every(v => typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v))) throw new Error('Balances are unavailable. Refresh to try again.');
  return { wallet: wallet.toLowerCase(), chainId, usdc: BigInt(usdc as string), native: BigInt(native as string) };
}
/** What a purchase really costs: the spend, plus the USDC Circle's Paymaster
 * takes for the network fee where it is doing the paying. Counting the fee here
 * is what stops a full-balance buy from passing the form and failing at the
 * wallet prompt. */
export function purchaseTotal(chainId: number, amount: string) {
  return BigInt(parseUnits(amount, 6)) + (gaslessChain(chainId) ? feeCap(chainId) : 0n);
}
export function purchaseShortfall(balance: PurchaseBalance, amount: string) {
  return balance.usdc < purchaseTotal(balance.chainId, amount);
}
export function purchaseError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/reject|denied|4001/i.test(message)) return 'Wallet request declined. No confirmation has been recorded. Check the purchase status before retrying.';
  if (/native gas|sponsorship|Permit2|on .*chain|on Base|on Ethereum/i.test(message)) return message;
  if (/insufficient|balance|funds/i.test(message)) return 'Not enough funds on this network. Check your USDC and network fee balance, then refresh.';
  if (/expired|minimum output|quote moved/i.test(message)) return 'The price changed or the quote expired. Request a fresh quote before signing.';
  if (/different smart account/i.test(message)) return 'This wallet uses a different smart account. Choose a compatible wallet; its configuration has not been changed.';
  if (/switch to|reconnect|balances are unavailable/i.test(message)) return message;
  return 'We could not complete this step. Check your wallet and purchase status before trying again.';
}
