import "server-only";
import { chain, tokenRef } from "../chains";
import { http, type Transport } from "../http";
import type { TokenRef } from "../types";
export type CoinMetadata = { id: string; symbol: string; name: string; platforms: Record<string, string>; detail_platforms?: Record<string, { decimal_place: number | null; contract_address: string }>; categories: string[]; description: { en?: string }; market_data?: { current_price?: { usd?: number }; price_change_percentage_24h?: number | null; market_cap?: { usd?: number }; total_volume?: { usd?: number } } };
export function createCoinGecko(request: Transport = http) {
  function get<T>(path: string, ttl = 60_000) {
    const pro = process.env.COINGECKO_API_PLAN === "pro", key = process.env.COINGECKO_API_KEY;
    return request<T>("CoinGecko", `https://${pro ? "pro-api" : "api"}.coingecko.com/api/v3${path}`, { ttl, headers: key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {} });
  }
  function id(value: string) { if (!/^[a-z0-9-]{1,100}$/.test(value)) throw new Error("Invalid CoinGecko id."); return value; }
  return {
    get,
    metadata: (coinId: string) => get<CoinMetadata>(`/coins/${id(coinId)}?localization=false&tickers=false&community_data=false&developer_data=false`, 300_000),
    contract: (token: TokenRef) => { const t = tokenRef(token); return get<CoinMetadata>(`/coins/${chain(t.chainId).gecko}/contract/${t.address}`, 60_000); },
    history: (coinId: string, days = 30) => { if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("History supports 1–365 days."); return get<{ prices: [number, number][]; market_caps: [number, number][]; total_volumes: [number, number][] }>(`/coins/${id(coinId)}/market_chart?vs_currency=usd&days=${days}`); },
  };
}
export const coinGecko = createCoinGecko();
