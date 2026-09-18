/** Holds every catalog pin to reality.
 *
 * Run before adding an entry, and whenever the buy screen's defaults are in
 * doubt:  `npx tsx scripts/verify-catalog.ts`
 *
 * Three checks, because each has caught a different real mistake:
 *
 *  1. `symbol()` and `decimals()` onchain. A wrong address is a Buy button
 *     pointing at the wrong token, and a wrong decimal count misplaces the
 *     decimal point in what the buyer is told they receive.
 *  2. Uniswap actually quotes it. Tesla, Meta and SpaceX all hold millions in
 *     Aerodrome liquidity on Base and are useless here, because Uniswap cannot
 *     reach that liquidity and answers with 100% price impact.
 *  3. Price impact at real buy sizes. A pool can be deep enough to quote and
 *     still be a bad deal for $50.
 *
 * Read-only: quotes and eth_calls, never a transaction.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG_ENTRIES, primaryChain } from '../lib/crypto/catalog';
import { CHAINS, type ChainId } from '../lib/crypto/chains';

for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i > 0 && !line.trim().startsWith('#')) process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const MAX_IMPACT_50 = 1.5, MAX_IMPACT_250 = 3;
const wallet = `0x${'11'.repeat(20)}`;
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

function decodeString(hex: string): string {
  const body = hex.slice(2);
  if (body.length === 64) {
    const trimmed = body.replace(/0+$/, '');
    return Buffer.from(trimmed.length % 2 ? `${trimmed}0` : trimmed, 'hex').toString('utf8').replace(/\0/g, '');
  }
  const length = parseInt(body.slice(64, 128), 16);
  return Buffer.from(body.slice(128, 128 + length * 2), 'hex').toString('utf8');
}

/** The configured RPCs are shared and public. A rate limit is not a finding
 * about the catalog, so it is waited out rather than reported as one. */
async function retry<T>(label: string, attempt: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await attempt(); }
    catch (error) {
      last = error;
      if (!/rate limit|429|too many/i.test(error instanceof Error ? error.message : '')) throw error;
      const wait = 2000 * (i + 1);
      console.log(`    ${label}: rate limited, waiting ${wait / 1000}s`);
      await pause(wait);
    }
  }
  throw last;
}

async function ethCall(chainId: number, to: string, data: string): Promise<string> {
  const url = process.env[`CRYPTO_RPC_URL_${chainId}`];
  if (!url) throw new Error(`CRYPTO_RPC_URL_${chainId} is not configured`);
  return retry(`chain ${chainId}`, async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) });
    const body = await response.json() as { result?: string; error?: { message: string } };
    if (body.error) throw new Error(body.error.message);
    if (!body.result) throw new Error('empty result');
    return body.result;
  });
}

async function priceImpact(chainId: number, token: string, usd: number): Promise<number | null> {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new Error('UNISWAP_API_KEY is not configured');
  const response = await fetch('https://trade-api.gateway.uniswap.org/v1/quote', {
    method: 'POST',
    headers: { 'x-api-key': key, 'content-type': 'application/json', 'x-chained-actions-enabled': 'true' },
    body: JSON.stringify({ type: 'EXACT_INPUT', tokenIn: CHAINS[chainId as ChainId].usdc, tokenOut: token, tokenInChainId: chainId, tokenOutChainId: chainId, swapper: wallet, recipient: wallet, amount: String(usd * 1e6), permitAmount: 'EXACT', slippageTolerance: 0.5 }),
  });
  if (response.status === 429) { await pause(3000); return priceImpact(chainId, token, usd); }
  if (!response.ok) return null;
  const body = await response.json() as { quote?: { priceImpact?: number } };
  const impact = Number(body.quote?.priceImpact);
  return Number.isFinite(impact) ? impact : null;
}

async function main() {
  const problems: string[] = [];

  for (const entry of CATALOG_ENTRIES) {
    for (const [id, token] of Object.entries(entry.contracts)) {
      const chainId = Number(id);
      const where = `${entry.symbol} on ${CHAINS[chainId as ChainId].name}`;
      try {
        const symbol = decodeString(await ethCall(chainId, token!, '0x95d89b41'));
        await pause(700);
        const decimals = parseInt(await ethCall(chainId, token!, '0x313ce567'), 16);
        await pause(700);
        if (symbol !== entry.symbol) problems.push(`${where}: contract says "${symbol}", catalog says "${entry.symbol}"`);
        if (decimals !== entry.decimals) problems.push(`${where}: contract has ${decimals} decimals, catalog says ${entry.decimals}`);
        // Only the chain the app actually buys on has to be tradeable through Uniswap.
        if (chainId !== primaryChain(entry)) { console.log(`  ${where.padEnd(34)} symbol ok · decimals ${decimals} · alternate listing`); continue; }
        const small = await priceImpact(chainId, token!, 50);
        await pause(500);
        const large = await priceImpact(chainId, token!, 250);
        await pause(500);
        if (small === null || large === null) problems.push(`${where}: Uniswap returned no quote`);
        else {
          if (small > MAX_IMPACT_50) problems.push(`${where}: ${small}% price impact on a $50 buy`);
          if (large > MAX_IMPACT_250) problems.push(`${where}: ${large}% price impact on a $250 buy`);
        }
        console.log(`  ${where.padEnd(34)} symbol ok · decimals ${decimals} · impact ${small ?? '—'}% / ${large ?? '—'}%`);
      } catch (error) {
        problems.push(`${where}: ${error instanceof Error ? error.message : 'unreachable'}`);
      }
    }
  }

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`\nAll ${CATALOG_ENTRIES.length} catalog entries verified.`);
}

main().catch(error => { console.error(error); process.exit(1); });
