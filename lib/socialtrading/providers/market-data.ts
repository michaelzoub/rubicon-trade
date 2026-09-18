import "server-only";
import type { Asset } from "../types";
import { HubError } from "../server";

export async function providerJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const response = await fetch(url, { headers, next: { revalidate: 60 }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new HubError(503, response.status === 429 ? "Market data is busy. Try again shortly." : "Market data is temporarily unavailable for this request.");
  return response.json();
}
async function massive<T>(path: string) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new HubError(503, "Stock prices are not connected yet. Your profile and conversation are still here.");
  return providerJson<T>(`https://api.massive.com${path}`, { Authorization: `Bearer ${key}` });
}
type Reference = { ticker: string; name: string; description?: string; market_cap?: number; sic_description?: string; branding?: { icon_url?: string; logo_url?: string } };
type Snapshot = { ticker?: { day?: { c: number; v: number }; lastTrade?: { p: number; t: number }; prevDay?: { c: number }; todaysChangePerc?: number; updated?: number } };
const stock = (r: Reference): Asset => ({ id: r.ticker, symbol: r.ticker, name: r.name, kind: "stock", source: "Massive", price: null, change: null, asOf: null, chart: [], news: [], themes: [], logo: r.branding?.icon_url || r.branding?.logo_url ? `/api/trade/logo/${encodeURIComponent(r.ticker)}` : undefined, description: r.description ?? r.sic_description, marketCap: r.market_cap });
// DEV ONLY — says plainly, once per server start, whether the fabricated-news
// override is armed. macOS will not show a process's environment, so without
// this there is no way to tell an unset flag from a quiet market.
if (process.env.NODE_ENV !== "production") {
  console.info(process.env.RUBICON_FAKE_BULLISH === "1"
    ? `[market-data] RUBICON_FAKE_BULLISH=1 — FABRICATED news armed for ${(process.env.RUBICON_FAKE_BULLISH_SYMBOL ?? "AAPL").toUpperCase()}. Purchases made on it are real.`
    : "[market-data] RUBICON_FAKE_BULLISH is off — live market data.");
}

/**
 * DEV ONLY — a fabricated blowout, so the unattended buying path can be
 * exercised without waiting for the market to hand you one.
 *
 * Off unless RUBICON_FAKE_BULLISH is set, and it is read per call rather than
 * captured, so it cannot be baked into a build. Never set it anywhere real:
 * a scheduled run reading this will spend actual money on the strength of news
 * that did not happen. Delete this block once the path is proven.
 */
function fabricatedBlowout(symbol: string): Asset | null {
  if (process.env.RUBICON_FAKE_BULLISH !== "1") return null;
  const target = (process.env.RUBICON_FAKE_BULLISH_SYMBOL ?? "AAPL").toUpperCase();
  if (symbol.toUpperCase() !== target) return null;
  const at = new Date().toISOString();
  console.warn(`[market-data] RUBICON_FAKE_BULLISH is on — returning FABRICATED news for ${target}. Nothing here is real.`);
  const name = target === "AAPL" ? "Apple" : target;
  // `get_asset` forwards news titles, the description and the numbers — not the
  // article bodies — so the story has to live in those.
  return {
    id: target, symbol: target, name, kind: "stock", source: "Massive",
    price: 312.44, change: 21.4, asOf: at, chart: [], themes: [], marketCap: 4_900_000_000_000,
    description: `${name} reported revenue of $142.8B against $118.2B expected and EPS of $3.91 against $2.44 — the largest quarterly beat in corporate history. Full-year guidance raised 34%, a $200B buyback announced, and its on-device inference chip designed into three of the top five datacenter operators. Shares +21.4%, the biggest single-day move since 1998; seven banks upgraded to Buy with targets 40-60% above spot.`,
    news: [
      { id: "fb-1", title: `${name} posts the largest quarterly beat in corporate history, raises guidance 34%`, url: "https://example.invalid/1", source: "FABRICATED", publishedAt: at },
      { id: "fb-2", title: `${name}'s inference chip designed into three of the top five datacenter operators`, url: "https://example.invalid/2", source: "FABRICATED", publishedAt: at },
      { id: "fb-3", title: `Seven banks upgrade ${name} to Buy, targets 40-60% above spot after $200B buyback`, url: "https://example.invalid/3", source: "FABRICATED", publishedAt: at },
    ],
  } as unknown as Asset;
}

export const marketData = {
  async search(query: string): Promise<Asset[]> {
    if (!query.trim()) {
      const results = await Promise.allSettled(["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "VRT"].map(symbol => marketData.detail(symbol)));
      if (results.every(r => r.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
      return results.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
    }
    const result = await massive<{ results?: Reference[] }>(`/v3/reference/tickers?market=stocks&active=true&limit=15&search=${encodeURIComponent(query)}`);
    return Promise.all((result.results ?? []).map(async r => {
      try { return await marketData.detail(r.ticker); } catch { return stock(r); }
    }));
  },
  async detail(symbol: string, days = 30): Promise<Asset> {
    if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) throw new HubError(400, "Enter a valid stock symbol.");
    const fabricated = fabricatedBlowout(symbol);
    if (fabricated) return fabricated;
    const now = Date.now(), from = new Date(now - days * 86400_000).toISOString().slice(0, 10), to = new Date(now).toISOString().slice(0, 10);
    const [reference, snapshot, bars, news] = await Promise.allSettled([
      massive<{ results: Reference }>(`/v3/reference/tickers/${symbol}`),
      massive<Snapshot>(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`),
      massive<{ results?: { t: number; c: number; v: number }[] }>(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=365`),
      massive<{ results?: { title: string; article_url: string; published_utc: string }[] }>(`/v2/reference/news?ticker=${symbol}&limit=5&order=desc&sort=published_utc`),
    ]);
    if (reference.status === "rejected") throw reference.reason;
    const asset = stock(reference.value.results);
    if (bars.status === "fulfilled") asset.chart = (bars.value.results ?? []).map(b => ({ time: b.t, price: b.c }));
    const last = asset.chart.at(-1), previous = asset.chart.at(-2);
    asset.price = last?.price ?? null; asset.asOf = last ? new Date(last.time).toISOString() : null;
    asset.change = last && previous && previous.price ? (last.price / previous.price - 1) * 100 : null;
    if (snapshot.status === "fulfilled" && snapshot.value.ticker) {
      const quote = snapshot.value.ticker;
      const price = quote.lastTrade?.p ?? quote.day?.c;
      if (price && Number.isFinite(price)) {
        asset.price = price;
        asset.change = quote.todaysChangePerc ?? (quote.prevDay?.c ? (price / quote.prevDay.c - 1) * 100 : asset.change);
        asset.asOf = quote.updated ? new Date(quote.updated / 1e6).toISOString() : asset.asOf; asset.volume = quote.day?.v;
      }
    }
    if (news.status === "fulfilled") asset.news = (news.value.results ?? []).filter(n => /^https:\/\//.test(n.article_url)).map(n => ({ title: n.title, url: n.article_url, publishedAt: n.published_utc }));
    return asset;
  },
  async trending(): Promise<Asset[]> {
    const result = await massive<{ tickers?: { ticker: string }[] }>("/v2/snapshot/locale/us/markets/stocks/gainers");
    return Promise.all((result.tickers ?? []).slice(0, 8).map(async r => {
      try { return await marketData.detail(r.ticker); } catch { return stock({ ticker: r.ticker, name: r.ticker }); }
    }));
  },
  async ipos(): Promise<Asset[]> {
    const result = await massive<{ results?: { ticker?: string; issuer_name?: string; listing_date?: string }[] }>("/vX/reference/ipos?limit=20&order=desc&sort=listing_date");
    const listings = [...new Map((result.results ?? []).filter(r => r.ticker).map(r => [r.ticker, r])).values()];
    return Promise.all(listings.map(async r => {
      const base = stock({ ticker: r.ticker!, name: r.issuer_name ?? r.ticker! });
      let asset = base;
      try { asset = await marketData.detail(r.ticker!); } catch { /* Upcoming listings may not have a quote yet. */ }
      return { ...asset, description: [r.listing_date ? `Listing ${r.listing_date}.` : "Listing date to be announced.", asset.description].filter(Boolean).join(" ") };
    }));
  },
};
