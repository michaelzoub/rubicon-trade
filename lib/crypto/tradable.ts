import { CHAIN_IDS, CHAINS, DEFAULT_CHAIN, type ChainId } from './chains';
import { CATALOG_ENTRIES, primaryChain, type CatalogEntry } from './catalog';

/** The one chain the app buys on.
 *
 * Base holds by far the deepest tokenized-equity liquidity that Uniswap can
 * actually reach — five household names quoting under 1.2% price impact at $250
 * — so settling everything there removes the crossing entirely rather than
 * engineering around it. Balances on other networks are still readable, and
 * Profile → Send something out can move them, but nothing is bought elsewhere. */
export const BUY_CHAIN: ChainId = DEFAULT_CHAIN;

/** Whether money may be moved from another network to reach a purchase.
 *
 * Off. Everything the app does happens on Base: it reads one chain, quotes on
 * one chain, and settles on one chain, so there is no network to switch and no
 * multi-step route to strand a purchase halfway.
 *
 * The consequence is deliberate and worth knowing: USDC sitting on Ethereum or
 * Arbitrum cannot be spent here. The panel says so by name and points at Base,
 * and Profile → Send something out moves it. Turning this back on re-enables
 * `lib/crypto/bridges.ts`, which is tested and works — it is switched off
 * because one chain is simpler, not because it is broken. */
export const CROSS_CHAIN_FUNDING = false;

/** The networks the app reads balances on. One, while funding stays single-chain. */
export const FUNDING_CHAINS: ChainId[] = CROSS_CHAIN_FUNDING ? CHAIN_IDS : [BUY_CHAIN];

/** What the app can do with something it is showing you.
 *
 * Every Buy affordance and every agent proposal resolves through here, so a
 * screen can never offer a purchase the execution path would refuse. */
export type Tradability =
  | { status: 'tradable'; chainId: ChainId; token: string; symbol: string; name: string; decimals: number; kind: 'stock' | 'crypto'; icon?: string; via: 'catalog' | 'contract' }
  | { status: 'unavailable'; reason: string; detail: string };

export type Displayable = {
  symbol: string; name?: string; kind?: string;
  /** Crypto assets carry verified contracts per chain id, from CoinGecko. */
  contracts?: Record<string, string> | null;
};

const clean = (value: string) => value.trim().toUpperCase();

/** A tokenized stock trades under its own ticker — `NVDAc`, not `NVDA` — so the
 * underlying it represents is recorded explicitly rather than guessed by
 * trimming a letter, which would map `AERO` onto `AER`. */
export function catalogFor(asset: Displayable): CatalogEntry | undefined {
  const symbol = clean(asset.symbol);
  return CATALOG_ENTRIES.find(entry =>
    clean(entry.symbol) === symbol
    || (entry.underlying ? clean(entry.underlying) === symbol : false));
}

export function tradability(asset: Displayable): Tradability {
  const entry = catalogFor(asset);
  if (entry) {
    const chainId = primaryChain(entry);
    const token = entry.contracts[chainId];
    if (token && chainId === BUY_CHAIN) {
      return { status: 'tradable', chainId, token, symbol: entry.symbol, name: entry.name, decimals: entry.decimals, kind: entry.kind, icon: entry.icon, via: 'catalog' };
    }
    // Listed, but not where the app settles. Reachable by search, not by a card.
    if (token) return { status: 'unavailable', reason: `On ${CHAINS[chainId].name}`, detail: `${entry.symbol} trades on ${CHAINS[chainId].name} rather than ${CHAINS[BUY_CHAIN].name}. Search for it to buy it directly.` };
  }

  // A crypto asset that publishes a Base contract is buyable on its own terms.
  const onBase = asset.contracts?.[String(BUY_CHAIN)];
  if (onBase && /^0x[0-9a-fA-F]{40}$/.test(onBase)) {
    return { status: 'tradable', chainId: BUY_CHAIN, token: onBase.toLowerCase(), symbol: clean(asset.symbol), name: asset.name ?? clean(asset.symbol), decimals: 18, kind: 'crypto', via: 'contract' };
  }

  const elsewhere = Object.keys(asset.contracts ?? {}).map(Number).filter(id => id in CHAINS && id !== BUY_CHAIN);
  if (elsewhere.length) {
    return { status: 'unavailable', reason: 'Not on Base', detail: `${clean(asset.symbol)} exists on ${elsewhere.map(id => CHAINS[id as ChainId].name).join(' and ')} but has no ${CHAINS[BUY_CHAIN].name} market, so Rubicon can’t buy it yet.` };
  }
  if (asset.kind === 'stock' || asset.kind === 'equity') {
    return { status: 'unavailable', reason: 'No tokenized market', detail: `${clean(asset.symbol)} has no tokenized version on ${CHAINS[BUY_CHAIN].name} yet. You can follow it, and Rubicon will offer it if one appears.` };
  }
  return { status: 'unavailable', reason: 'Not on Base', detail: `Rubicon buys on ${CHAINS[BUY_CHAIN].name}, and ${clean(asset.symbol)} has no market there yet.` };
}

export const isTradable = (asset: Displayable) => tradability(asset).status === 'tradable';
