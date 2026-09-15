import "server-only";
import { chain, tokenRef } from "../chains";
import { http, type Transport } from "../http";
import type { DiscoveryProvider, Pair, TokenRef } from "../types";
type RawPair = { chainId: string; dexId: string; pairAddress: string; url: string; baseToken: Pair["base"]; quoteToken: Pair["quote"]; priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { h24?: number }; marketCap?: number };
const number = (v: unknown) => (typeof v === "number" || typeof v === "string") && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
export function createDexScreener(request: Transport = http): DiscoveryProvider {
  const normalize = (pairs: RawPair[] | null): Pair[] => (pairs ?? []).filter(p => p?.baseToken && p?.quoteToken && p.pairAddress).slice(0, 30).map(p => ({ source: "dexscreener", chain: p.chainId, address: p.pairAddress, dex: p.dexId, url: p.url?.startsWith("https://dexscreener.com/") ? p.url : "", base: p.baseToken, quote: p.quoteToken, priceUsd: number(p.priceUsd), liquidityUsd: number(p.liquidity?.usd), volume24h: number(p.volume?.h24), change24h: number(p.priceChange?.h24), marketCap: number(p.marketCap), fetchedAt: new Date().toISOString() }));
  return {
    async search(query: string) { if (!query.trim() || query.length > 100) throw new Error("Enter a search query of 1–100 characters."); const data = await request<{ pairs: RawPair[] | null }>("DexScreener", `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`, { ttl: 10_000 }); return normalize(data.pairs); },
    async pairs(token: TokenRef) { const t = tokenRef(token); return normalize(await request<RawPair[]>("DexScreener", `https://api.dexscreener.com/token-pairs/v1/${chain(t.chainId).dex}/${t.address}`, { ttl: 10_000 })); },
  };
}
