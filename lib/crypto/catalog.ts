import { DEFAULT_CHAIN, feeReserveUsd, type ChainId } from './chains';

/** One asset the app offers by name, pinned to an exact contract.
 *
 * Pinning is the point. An open DexScreener search will happily return a token
 * that calls itself NVDA and is not, so anything shown without the user typing
 * a name is resolved here instead. Search still reaches everything else, with
 * its existing thin-liquidity warning.
 *
 * `symbol` is the contract's own casing, not a prettified version — the
 * verification script holds each pin to what `symbol()` returns, and Coinbase's
 * tokenized stocks really are `NVDAc`, not `NVDAC`. */
export type CatalogEntry = {
  symbol: string; name: string; kind: 'stock' | 'crypto';
  /** Read from the contract. These are not all 18: the tokenized stocks are 8,
   * and assuming otherwise misplaces the decimal point in what someone receives. */
  decimals: number;
  /** CoinGecko's own artwork. `AssetLogo` falls back to initials if it fails. */
  icon?: string;
  /** For a tokenized stock, the ticker it represents. Recorded rather than
   * derived: trimming a letter off `AERO` would claim it tracks `AER`. */
  underlying?: string;
  /** Cheapest supported chain first: fees decide whether a $25 buy is possible. */
  contracts: Partial<Record<ChainId, string>>;
};

/** Nothing reaches this list without passing `scripts/verify-catalog.ts`, which
 * holds every pin to its onchain `symbol()` and `decimals()`, asks Uniswap for a
 * real quote, and refuses anything whose price impact makes a small buy a bad
 * deal. Tesla, Meta and SpaceX all exist on Base with millions in Aerodrome
 * liquidity and are absent here for exactly that reason: Uniswap cannot reach
 * that liquidity, and quoting them returns 100% price impact. */
export const CATALOG: { title: string; note?: string; entries: CatalogEntry[] }[] = [
  {
    title: 'Stocks',
    note: 'Tokenized stock exposure · not brokerage shares.',
    entries: [
      { symbol: 'NVDAc', underlying: 'NVDA', name: 'NVIDIA', kind: 'stock', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/102175596/large/nvda_200x200.png?1787068801', contracts: { 8453: '0xb20000000000000000000078ee7ce2fe4908108c' } },
      { symbol: 'AAPLc', underlying: 'AAPL', name: 'Apple', kind: 'stock', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/102175597/large/aapl_200x200.png?1787068801', contracts: { 8453: '0xb200000000000000000000c2e324d24d7eecd1fb' } },
      { symbol: 'GOOGLc', underlying: 'GOOGL', name: 'Alphabet', kind: 'stock', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/102175598/large/goog_200x200.png?1787068802', contracts: { 8453: '0xb2000000000000000000002d0ba3164cc74f58b7' } },
      { symbol: 'MSFTc', underlying: 'MSFT', name: 'Microsoft', kind: 'stock', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/102178281/large/msft-200.png?1789233933', contracts: { 8453: '0xb200000000000000000000ab99cfa739e253872b' } },
      { symbol: 'AMZNc', underlying: 'AMZN', name: 'Amazon', kind: 'stock', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/102178280/large/amzn-200.png?1789233782', contracts: { 8453: '0xb200000000000000000000d9192b6b456483c2e8' } },
    ],
  },
  {
    title: 'Crypto',
    entries: [
      { symbol: 'WETH', name: 'Ether', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/39810/small/weth.png?1724139790', contracts: { 8453: '0x4200000000000000000000000000000000000006', 42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 10: '0x4200000000000000000000000000000000000006', 137: '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' } },
      { symbol: 'cbBTC', name: 'Bitcoin', kind: 'crypto', decimals: 8, icon: 'https://coin-images.coingecko.com/coins/images/40143/small/cbbtc.webp?1726136727', contracts: { 8453: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf' } },
      { symbol: 'AERO', name: 'Aerodrome', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/31745/small/token.png?1696530564', contracts: { 8453: '0x940181a94a35a4569e4529a3cdfb74e38fd98631' } },
      { symbol: 'VIRTUAL', name: 'Virtuals Protocol', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/34057/small/LOGOMARK.png?1708356054', contracts: { 8453: '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b' } },
      { symbol: 'AAVE', name: 'Aave', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/12645/small/aave-token-round.png?1720472354', contracts: { 8453: '0x63706e401c06ac8513145b7687a14804d17f814b' } },
      { symbol: 'LINK', name: 'Chainlink', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/877/small/Chainlink_Logo_500.png?1760023405', contracts: { 42161: '0xf97f4df75117a78c1a5a0dbb814af92458539fb4' } },
      { symbol: 'PENDLE', name: 'Pendle', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/15069/small/Pendle_Logo_Normal-03.png?1696514728', contracts: { 42161: '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8' } },
      { symbol: 'wstETH', name: 'Lido Staked Ether', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/53102/small/arbitrum-bridged-wsteth-arbitrum.webp?1735227527', contracts: { 42161: '0x5979d7b546e38e414f7e9822514be443a4800529' } },
      { symbol: 'UNI', name: 'Uniswap', kind: 'crypto', decimals: 18, icon: 'https://coin-images.coingecko.com/coins/images/12504/small/uniswap-logo.png?1720676669', contracts: { 1: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' } },
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

/** The entry for a chain and contract, so a quote's output is shown in the
 * token's real units rather than assumed to be eighteen decimals. */
export const catalogEntry = (chainId: number, token: string) =>
  CATALOG_ENTRIES.find(e => e.contracts[chainId as ChainId]?.toLowerCase() === token.toLowerCase());
