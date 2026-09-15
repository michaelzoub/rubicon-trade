import "server-only";
import { chain, NATIVE, tokenRef } from "../chains";
import { http, type Transport } from "../http";
import type { TokenRef, ValuationProvider } from "../types";
type Price = { price: number; decimals?: number; timestamp: number; confidence?: number; symbol: string };
export function createDefiLlama(request: Transport = http) {
  async function price(token: TokenRef) {
    const t = tokenRef(token), c = chain(t.chainId), key = t.address === NATIVE ? `coingecko:${c.native}` : `${c.llama}:${t.address}`;
    const data = await request<{ coins: Record<string, Price> }>("DefiLlama", `https://coins.llama.fi/prices/current/${encodeURIComponent(key)}`, { ttl: 15_000 });
    const p = data.coins[key]; if (!p || !Number.isFinite(p.price) || p.price <= 0 || !Number.isFinite(p.timestamp) || Math.abs(Date.now() / 1000 - p.timestamp) > 300 || (p.confidence !== undefined && p.confidence < .9)) throw new Error("A fresh, reliable USD valuation is unavailable for this token.");
    return { ...p, decimals: t.address === NATIVE ? 18 : p.decimals };
  }
  const valuation: ValuationProvider = { async value(token, amount) {
    if (!/^[1-9][0-9]{0,77}$/.test(amount)) throw new Error("Invalid base-unit amount.");
    const p = await price(token);
    if (!Number.isInteger(p.decimals) || p.decimals! < 0 || p.decimals! > 36) throw new Error("Token decimals are unavailable.");
    const value = Number(amount) / 10 ** p.decimals! * p.price;
    if (!Number.isFinite(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER / 100) throw new Error("Invalid USD valuation.");
    return Math.ceil(value * 100) / 100;
  } };
  return { ...valuation, price,
    async protocols(query = "") { const data = await request<{ name: string; slug: string; chains: string[]; category: string; tvl: number; change_1d?: number }[]>("DefiLlama", "https://api.llama.fi/protocols", { ttl: 300_000 }); return data.filter(p => !query || `${p.name} ${p.category} ${p.chains?.join(" ")}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.tvl - a.tvl).slice(0, 20).map(({ name, slug, chains, category, tvl, change_1d }) => ({ name, slug, chains, category, tvl, change_1d })); },
  };
}
