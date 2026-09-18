"use client";
import { useEffect, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { useHub } from "./hub-provider";
import { usd, pct } from "./format";
import { PriceTrace } from "./price-trace";

export function useMarketAsset(initial: Asset): Asset {
  const { market } = useHub();
  const [loaded, setLoaded] = useState<Asset | null>(null);
  const incomplete = initial.price == null || initial.change == null || initial.chart.length < 2;
  useEffect(() => {
    let live = true;
    setLoaded(null);
    if (incomplete) void market({ kind: initial.kind, id: initial.id, days: "7" }).then(([asset]) => { if (live) setLoaded(asset ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [market, initial.kind, initial.id, incomplete]);
  return loaded && loaded.id === initial.id ? { ...initial, price: initial.price ?? loaded.price, change: initial.change ?? loaded.change, chart: initial.chart.length > 1 ? initial.chart : loaded.chart } : initial;
}

export function MarketQuote({ chainId, contract, price, change, chart = [], large = false }: {
  chainId: number; contract: string; price?: number | null; change?: number | null; chart?: Asset["chart"]; large?: boolean;
}) {
  const { market } = useHub();
  const [data, setData] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setData(null); setLoading(true);
    void market({ kind: "token", chainId: String(chainId), contract, days: "7" }).then(([asset]) => { if (live) setData(asset ?? null); }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [market, chainId, contract]);
  const value = data?.price ?? price;
  const delta = data?.change ?? change;
  const points = data?.chart.length ? data.chart : chart;
  // A number that is on its way is shown as the shape it will take, shimmering,
  // the way the rest of Rubicon waits. Words like "Loading price…" sit in the
  // slot the price will occupy and change its width when they leave.
  return <span className={`hub-market-quote${large ? " is-large" : ""}${loading ? " is-loading" : ""}`} aria-label="Token market data" aria-busy={loading || undefined}>
    <span className="hub-market-quote-values">
      <strong>{value == null ? loading ? <span className="rubicon-skeleton hub-quote-skeleton is-price" /> : "Price unavailable" : usd(value)}</strong>
      <span className={`hub-change${delta != null && delta > 0 ? " is-up" : delta != null && delta < 0 ? " is-down" : ""}`}>{delta == null ? loading ? <span className="rubicon-skeleton hub-quote-skeleton is-change" /> : "24h change unavailable" : `${pct(delta)} · 24h`}</span>
    </span>
    {points.length > 1 ? <span className="hub-market-quote-chart"><PriceTrace points={points} height={large ? 110 : 32} scrub={false} label="Token price history, last 7 days" /></span>
      : loading ? <span className="rubicon-skeleton hub-quote-skeleton is-chart" style={{ height: large ? 110 : 32 }} />
      : <small>Price history unavailable</small>}
  </span>;
}
