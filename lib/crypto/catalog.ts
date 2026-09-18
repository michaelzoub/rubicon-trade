import { DEFAULT_CHAIN, feeReserveUsd, type ChainId } from './chains';

/** One asset the app offers by name, pinned to an exact contract.
 *
 * Pinning is the point. An open DexScreener search will happily return a token
 * that calls itself NVDA and is not, so anything shown without the user typing
 * a name is resolved here instead. Search still reaches everything else, with
 * its existing thin-liquidity warning. */
export type CatalogEntry = {
  symbol: string; name: string; kind: 'stock' | 'crypto';
  /** Cheapest supported chain first: fees decide whether a $25 buy is possible. */
  contracts: Partial<Record<ChainId, string>>;
};

/** Every address below was verified before being written down — canonical
 * wrapped-native by an onchain `symbol()`/`decimals()` read, everything else by
 * taking the deepest live pool for an exact symbol match. Re-check with
 * `npx tsx scripts/verify-catalog.ts` before adding to this list. */
export const CATALOG: { title: string; note?: string; entries: CatalogEntry[] }[] = [
  {
    title: 'Popular',
    entries: [
      { symbol: 'WETH', name: 'Ether', kind: 'crypto', contracts: { 8453: '0x4200000000000000000000000000000000000006', 42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 10: '0x4200000000000000000000000000000000000006', 137: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' } },
      { symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', kind: 'crypto', contracts: { 8453: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf' } },
      { symbol: 'LINK', name: 'Chainlink', kind: 'crypto', contracts: { 42161: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4' } },
      { symbol: 'UNI', name: 'Uniswap', kind: 'crypto', contracts: { 1: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' } },
    ],
  },
  {
    title: 'Tokenized stocks',
    note: 'Tokenized stock exposure · not brokerage shares.',
    entries: [
      { symbol: 'MSTRX', name: 'MicroStrategy xStock', kind: 'stock', contracts: { 8453: '0xc14d1f6fffbb78ca56e31afe40a57c29d392e913' } },
      { symbol: 'AAPLx', name: 'Apple xStock', kind: 'stock', contracts: { 8453: '0x2a173c03b7191f1c49224fca834630516ee7d1ec' } },
    ],
  },
  {
    title: 'Onchain',
    entries: [
      { symbol: 'AERO', name: 'Aerodrome', kind: 'crypto', contracts: { 8453: '0x940181a94a35a4569e4529a3cdfb74e38fd98631' } },
      { symbol: 'MORPHO', name: 'Morpho', kind: 'crypto', contracts: { 8453: '0xd78894eaf3f93adc3cc083feeaf87603414425c9' } },
      { symbol: 'VIRTUAL', name: 'Virtuals Protocol', kind: 'crypto', contracts: { 8453: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b' } },
      { symbol: 'AAVE', name: 'Aave', kind: 'crypto', contracts: { 8453: '0x63706e401c06ac8513145b7687a14804d17f814b' } },
      { symbol: 'PENDLE', name: 'Pendle', kind: 'crypto', contracts: { 42161: '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8' } },
      { symbol: 'wstETH', name: 'Lido Staked Ether', kind: 'crypto', contracts: { 42161: '0x5979d7b546e38e414f7e9822514be443a4800529' } },
    ],
  },
];

export const CATALOG_ENTRIES = CATALOG.flatMap(section => section.entries);

/** The chain an entry is bought on: the app's home chain when it lists there,
 * then whichever is cheapest.
 *
 * Explicitly sorted, never "the first key". JavaScript orders integer-like
 * object keys numerically regardless of how they were written, so a contracts
 * map beginning with Base would silently resolve to Ethereum — the one chain
 * where a $25 buy cannot pay for itself.
 *
 * Fee alone is the wrong tie-break. Polygon reserves fifteen cents less than
 * Base and holds a fraction of the liquidity, and slippage on a thin pool costs
 * a buyer far more than the fee it saves. */
export const primaryChain = (entry: CatalogEntry) =>
  (Object.keys(entry.contracts).map(Number) as ChainId[])
    .sort((a, b) => Number(b === DEFAULT_CHAIN) - Number(a === DEFAULT_CHAIN) || feeReserveUsd(a) - feeReserveUsd(b) || a - b)[0];
