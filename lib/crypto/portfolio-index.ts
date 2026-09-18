import 'server-only';
import { address } from './chains';
import { http } from './http';

const networks: Record<number, string> = { 1: 'eth-mainnet', 8453: 'base-mainnet', 42161: 'arb-mainnet', 10: 'opt-mainnet', 137: 'polygon-mainnet' };
/** Discover contracts, then read their actual balances/decimals over our own RPC.
 * Never trust an indexer's balance as permission to spend. */
export async function indexedTokens(chainId: number, wallet: string): Promise<{ tokens: string[]; complete: boolean }> {
  const key = process.env.ALCHEMY_API_KEY;
  if (!key) return { tokens: [], complete: false };
  const tokens = new Set<string>();
  let pageKey: string | undefined;
  for (let page = 0; page < 4; page++) {
    const response = await http<{ error?: unknown; result?: { tokenBalances: { contractAddress: string; tokenBalance: string | null; error?: string }[]; pageKey?: string } }>('Wallet index', `https://${networks[chainId]}.g.alchemy.com/v2/${encodeURIComponent(key)}`, {
      body: { jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [wallet, 'erc20', { maxCount: 100, ...(pageKey ? { pageKey } : {}) }] },
    });
    if (response.error || !Array.isArray(response.result?.tokenBalances)) throw new Error('Wallet token discovery is unavailable.');
    for (const row of response.result.tokenBalances) {
      if (row.error || !row.tokenBalance || !/^0x[0-9a-f]+$/i.test(row.tokenBalance) || BigInt(row.tokenBalance) === 0n) continue;
      tokens.add(address(row.contractAddress));
    }
    pageKey = response.result.pageKey;
    if (!pageKey) return { tokens: [...tokens], complete: true };
  }
  return { tokens: [...tokens], complete: false };
}
