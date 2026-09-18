import { CHAINS, type ChainId } from "./chains";
import type { Pair } from "./types";
import { CATALOG_ENTRIES, primaryChain } from "./catalog";

/** One buyable token on a supported EVM chain, chosen from its deepest DEX pair. */
export type TokenMatch = {
  chainId: ChainId; chain: string; address: string; symbol: string; name: string;
  priceUsd: number | null; liquidityUsd: number | null; volume24h: number | null; change24h: number | null;
  dex: string; url: string; quote: string;
  /** Best-effort label from issuer names (Backed, xStocks, Dinari, Ondo…). Display only, never an execution signal. */
  kind: "stock" | "crypto";
  /** Thin pools slip and can be spoofed; the UI warns before buying. */
  thin: boolean;
};

const TOKENIZED = /\b(backed|xstock|dinari|dshares?|ondo|tokeni[sz]ed|swarm|securitize)\b/i;
const STOCKISH = /^(b|x|d|on|t)?(AAPL|TSLA|NVDA|MSFT|AMZN|GOOGL?|META|SPY|SPX|CSPX|QQQ|COIN|MSTR|HOOD|NFLX|AMD|PLTR|IB01|IBTA|HIGH|C3M|ERNA|ZPR1|CRWV)(x|\.d)?$/i;
const dexToChain = new Map<string, ChainId>(Object.entries(CHAINS).map(([id, c]) => [c.dex, Number(id) as ChainId]));

/** Keep recommended instruments searchable even when discovery has no pair. */
export function withCatalogMatches(query: string, discovered: TokenMatch[] = []): TokenMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return discovered;
  const pinned = CATALOG_ENTRIES.filter(entry =>
    [entry.symbol, entry.name, entry.underlying ?? "", ...Object.values(entry.contracts)]
      .some(value => value.toLowerCase().includes(q)))
    .map(entry => {
      const chainId = primaryChain(entry), address = entry.contracts[chainId]!.toLowerCase();
      const market = discovered.find(token => token.chainId === chainId && token.address.toLowerCase() === address);
      return {
        chainId, chain: CHAINS[chainId].name,
        priceUsd: null, liquidityUsd: null, volume24h: null, change24h: null,
        dex: "", url: "", quote: "", thin: false,
        // The pin wins over whatever the market data carried.
        ...market, address, symbol: entry.symbol, name: entry.name, kind: entry.kind,
      } satisfies TokenMatch;
    });
  return [...pinned, ...discovered.filter(token => !pinned.some(match =>
    match.chainId === token.chainId && match.address === token.address.toLowerCase()))];
}

export function normalizeMatches(pairs: Pair[], query = ""): TokenMatch[] {
  const q = query.trim().toLowerCase(), best = new Map<string, TokenMatch>();
  for (const p of pairs) {
    const chainId = dexToChain.get(p.chain);
    if (!chainId || !/^0x[0-9a-fA-F]{40}$/.test(p.base.address)) continue;
    const address = p.base.address.toLowerCase(), key = `${chainId}:${address}`;
    const name = p.base.name ?? "", symbol = p.base.symbol ?? "";
    const match: TokenMatch = { chainId, chain: CHAINS[chainId].name, address, symbol, name, priceUsd: p.priceUsd, liquidityUsd: p.liquidityUsd, volume24h: p.volume24h, change24h: p.change24h, dex: p.dex, url: p.url, quote: p.quote.symbol ?? "", kind: TOKENIZED.test(name) || (STOCKISH.test(symbol) && TOKENIZED.test(`${name} ${p.dex}`)) ? "stock" : "crypto", thin: (p.liquidityUsd ?? 0) < 50_000 };
    const current = best.get(key);
    if (!current || (match.liquidityUsd ?? 0) > (current.liquidityUsd ?? 0)) best.set(key, match);
  }
  const exact = (m: TokenMatch) => m.symbol.toLowerCase() === q || m.address === q ? 1 : 0;
  return [...best.values()].sort((a, b) => exact(b) - exact(a) || (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, 12);
}
