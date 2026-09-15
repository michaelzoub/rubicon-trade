import "server-only";
import { createDexScreener } from "./providers/dexscreener";
import { coinGecko } from "./providers/coingecko";
import { createDefiLlama } from "./providers/defillama";
import { createUniswap } from "./providers/uniswap";
import type { DiscoveryProvider, ExecutionProvider, TokenRef, ValuationProvider } from "./types";
export function createCryptoServices(overrides: { discovery?: DiscoveryProvider; execution?: ExecutionProvider; valuation?: ValuationProvider; metadata?: typeof coinGecko; defi?: ReturnType<typeof createDefiLlama> } = {}) {
  const discovery = overrides.discovery ?? createDexScreener(), execution = overrides.execution ?? createUniswap(), defi = overrides.defi ?? createDefiLlama(), metadata = overrides.metadata ?? coinGecko;
  return { discovery, execution, valuation: overrides.valuation ?? defi, metadata, defi,
    async research(token: TokenRef) {
      const results = await Promise.allSettled([discovery.pairs(token), metadata.contract(token).then(m => ({ id: m.id, name: m.name, symbol: m.symbol, platforms: m.platforms, detail_platforms: m.detail_platforms, categories: m.categories, description: m.description?.en?.replace(/<[^>]*>/g, "").slice(0, 1500), market_data: m.market_data ? { current_price: m.market_data.current_price?.usd, market_cap: m.market_data.market_cap?.usd, total_volume: m.market_data.total_volume?.usd } : null })), defi.price(token)]);
      return { token, fetchedAt: new Date().toISOString(), sources: results.map((r, i) => ({ provider: ["DexScreener", "CoinGecko", "DefiLlama"][i], ...(r.status === "fulfilled" ? { data: r.value } : { error: r.reason instanceof Error ? r.reason.message : "Unavailable" }) })) };
    },
  };
}
export const cryptoServices = createCryptoServices();
