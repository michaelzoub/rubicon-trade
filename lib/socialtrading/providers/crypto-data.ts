import "server-only";
import { coinGecko } from "@/lib/crypto/providers/coingecko";
import { CHAINS } from "@/lib/crypto/chains";
import { HubError } from "../server";
import type { Asset } from "../types";

const gecko = coinGecko.get;
type Coin = { image?: string; id: string; symbol: string; name: string; current_price: number; price_change_percentage_24h: number; market_cap: number; total_volume: number; last_updated: string; sparkline_in_7d?: { price: number[] } };
function normalize(c: Coin): Asset {
  const prices = c.sparkline_in_7d?.price ?? [];
  const end = Date.parse(c.last_updated) || Date.now();
  const chart = prices.map((price, i) => ({ time: end - (prices.length - 1 - i) * 3600_000, price })).filter(p => Number.isFinite(p.price));
  return { id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, kind: "crypto", source: "CoinGecko", logo: c.image, price: c.current_price ?? null, change: c.price_change_percentage_24h ?? null, marketCap: c.market_cap, volume: c.total_volume, asOf: c.last_updated, themes: ["crypto"], chart, news: [] };
}
/** Contract per supported chain id, keeping only well-formed addresses. Symbols are never execution identifiers. */
export function contractsFrom(platforms: Record<string, string | null> | undefined): Record<string, string> | undefined {
  if (!platforms) return undefined;
  const out: Record<string, string> = {};
  for (const [id, c] of Object.entries(CHAINS)) { const a = platforms[c.gecko]; if (typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)) out[id] = a.toLowerCase(); }
  return Object.keys(out).length ? out : undefined;
}
export const cryptoData = {
  async search(query: string): Promise<Asset[]> {
    let ids = "";
    if (query) {
      const search = await gecko<{ coins: { id: string }[] }>(`/search?query=${encodeURIComponent(query)}`);
      ids = search.coins.slice(0, 15).map(c => c.id).join(",");
      if (!ids) return [];
    }
    return (await gecko<Coin[]>(`/coins/markets?vs_currency=usd&sparkline=true&per_page=15&order=market_cap_desc${ids ? `&ids=${encodeURIComponent(ids)}` : ""}`)).map(normalize);
  },
  async trending(): Promise<Asset[]> {
    const data = await gecko<{ coins: { item: { id: string } }[] }>("/search/trending");
    const ids = data.coins.slice(0, 15).map(c => c.item.id).join(",");
    return ids ? (await gecko<Coin[]>(`/coins/markets?vs_currency=usd&sparkline=true&ids=${encodeURIComponent(ids)}`)).map(normalize) : [];
  },
  async detail(id: string, days = 30): Promise<Asset> {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new HubError(400, "History supports 1–365 days.");
    if (!/^[a-z0-9-]{1,100}$/.test(id)) throw new HubError(400, "Invalid crypto asset.");
    const [coins, chart, metadata] = await Promise.allSettled([
      gecko<Coin[]>(`/coins/markets?vs_currency=usd&sparkline=true&ids=${id}`),
      gecko<{ prices: [number, number][] }>(`/coins/${id}/market_chart?vs_currency=usd&days=${days}`),
      gecko<{ categories: string[]; description: { en?: string }; platforms?: Record<string, string | null> }>(`/coins/${id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`),
    ]);
    if (coins.status === "rejected") throw coins.reason;
    if (!coins.value[0]) throw new HubError(404, "This crypto asset was not found.");
    const asset = normalize(coins.value[0]);
    if (chart.status === "fulfilled") asset.chart = chart.value.prices.map(([time, price]) => ({ time, price }));
    if (metadata.status === "fulfilled") {
      asset.themes.push(...metadata.value.categories); asset.description = metadata.value.description.en?.replace(/<[^>]*>/g, "").slice(0, 1500);
      asset.contracts = contractsFrom(metadata.value.platforms);
    }
    return asset;
  },
};
