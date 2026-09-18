import "server-only";
import { address, chain } from "@/lib/crypto/chains";
import { cryptoServices } from "@/lib/crypto/services";
import { normalizeMatches } from "@/lib/crypto/search";
import { catalogEntry } from "@/lib/crypto/catalog";
import type { Asset } from "../types";

/** Quotes and history are for the exact token, never a same-symbol instrument. */
export async function tokenMarket(chainId: number, contract: string, days: number): Promise<Asset> {
  chain(chainId);
  const token = address(contract), entry = catalogEntry(chainId, token);
  const ref = { chainId, address: token };
  const [pairs, metadata] = await Promise.allSettled([
    cryptoServices.discovery.pairs(ref), cryptoServices.metadata.contract(ref),
  ]);
  const quote = pairs.status === "fulfilled" ? normalizeMatches(pairs.value).find(p => p.chainId === chainId && p.address === token) : undefined;
  const meta = metadata.status === "fulfilled" ? metadata.value : undefined;
  const asset: Asset = {
    id: `${chainId}:${token}`, symbol: entry?.symbol ?? quote?.symbol ?? meta?.symbol ?? "Token",
    name: entry?.name ?? quote?.name ?? meta?.name ?? "Token", kind: entry?.kind ?? "crypto",
    source: quote ? "DexScreener" : "CoinGecko", price: quote?.priceUsd ?? meta?.market_data?.current_price?.usd ?? null,
    change: quote?.change24h ?? meta?.market_data?.price_change_percentage_24h ?? null, asOf: pairs.status === "fulfilled" ? pairs.value[0]?.fetchedAt ?? null : null,
    contracts: { [chainId]: token }, themes: [], chart: [], news: [],
  };
  if (meta) {
    try { asset.chart = (await cryptoServices.metadata.history(meta.id, days)).prices.map(([time, price]) => ({ time, price })).filter(p => Number.isFinite(p.price) && Number.isFinite(p.time)); }
    catch { /* Preserve the quote when historical coverage is unavailable. */ }
  }
  return asset;
}
