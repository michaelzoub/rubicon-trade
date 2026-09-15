"use client";

import { ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Asset } from "@/lib/socialtrading/types";
import { ChartFrame, ChartTooltip } from "../../_components/charts";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { compact, timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";
import { ChangeText, Fact, Facts, NewsList, RelevanceLabel, useFollowRoom } from "./parts";
import { BuyPanel } from "./buy-panel";

const RANGES = [7, 30, 90, 365] as const;

export function AssetDetail({ kind, id }: { kind: Asset["kind"]; id: string }) {
  const { market, state, signal, send, setDraft } = useHub();
  const router = useRouter();
  const [days, setDays] = useState<typeof RANGES[number]>(30);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  const follow = useFollowRoom();

  useEffect(() => {
    let cancelled = false;
    setError("");
    market({ kind, id, days: String(days) }).then(([a]) => {
      if (cancelled) return;
      setAsset(a ?? null);
      if (a && !opened.current) { opened.current = true; signal("opened", a); }
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "This asset could not be loaded."); });
    return () => { cancelled = true; };
  }, [market, kind, id, days, signal]);

  useGSAP(() => {
    if (!asset) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-detail-part]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .42, stagger: .05, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: stage, dependencies: [asset?.id] });

  const watched = !!asset && state.profile.interests.some(i => i.id === asset.id || i.symbol?.toUpperCase() === asset.symbol.toUpperCase());
  const data = (asset?.chart ?? []).map(p => ({ ...p, label: new Intl.DateTimeFormat("en-US", days <= 7 ? { weekday: "short", hour: "numeric" } : { month: "short", day: "numeric" }).format(new Date(p.time)) }));
  const min = Math.min(...data.map(d => d.price)), max = Math.max(...data.map(d => d.price));
  const ask = (text: string) => { if (asset) signal("followup", asset); setDraft(""); router.push("/"); void send(text); };

  return (
    <div ref={stage} className="hub-detail">
      <Link href="/explore" className="hub-back"><ArrowLeft size={14} aria-hidden="true" />Explore</Link>
      {error && <p className="hub-error" role="alert">{error}</p>}
      {!asset && !error && <div className="hub-skeleton-grid" role="status" aria-label="Loading asset"><span className="rubicon-skeleton hub-skeleton" /><span className="rubicon-skeleton hub-skeleton" /></div>}
      {asset && <>
        <header className="hub-detail-head" data-detail-part>
          <div>
            <p className="hub-detail-symbol mono">{asset.symbol} <span>· {asset.kind === "crypto" ? "Crypto" : "Stock"} · {asset.source}</span></p>
            <h1 className="landing-section-title">{asset.name}</h1>
            <RelevanceLabel asset={asset} />
          </div>
          <div className="hub-detail-price">
            <strong>{usd(asset.price)}</strong>
            <ChangeText value={asset.change} />
            {asset.asOf && <small>as of {timeAgo(asset.asOf)}</small>}
          </div>
        </header>
        <section className="hub-detail-chart" data-detail-part aria-label="Price history">
          <div className="hub-ranges" role="tablist" aria-label="Chart range">{RANGES.map(r => <button key={r} type="button" role="tab" aria-selected={days === r} className={`hub-tab${days === r ? " is-active" : ""}`} onClick={() => setDays(r)}>{r === 365 ? "1Y" : `${r}D`}</button>)}</div>
          {data.length > 1 ? <ChartFrame height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <XAxis dataKey="label" axisLine={{ stroke: "var(--line)" }} tickLine={false} interval="preserveStartEnd" minTickGap={48} tick={{ fill: "var(--quiet)", fontSize: 10 }} tickMargin={9} />
                <YAxis axisLine={false} tickLine={false} width={56} domain={[min, max]} tick={{ fill: "var(--quiet)", fontSize: 10 }} tickFormatter={v => usd(v, Math.abs(v) < 1 ? 4 : 0)} tickCount={4} orientation="right" />
                <Tooltip cursor={{ stroke: "var(--quiet)", strokeWidth: 1, strokeDasharray: "3 3" }} isAnimationActive={false} wrapperStyle={{ outline: "none", pointerEvents: "none" }}
                  content={({ active, payload }) => active && payload?.length ? <ChartTooltip label={new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: days <= 7 ? "short" : undefined }).format(new Date((payload[0].payload as { time: number }).time))} value={usd((payload[0].payload as { price: number }).price)} /> : null} />
                <Line type="monotone" dataKey="price" stroke="var(--ink)" strokeWidth={1.25} dot={false} activeDot={{ r: 3, fill: "var(--ink)", stroke: "white", strokeWidth: 1.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame> : <p className="hub-notice">No price history is available for this range.</p>}
        </section>
        <section className="hub-detail-why" data-detail-part>
          <p className="hub-part-title">Why this matters to you</p>
          <p>{asset.reason}</p>
          <div className="hub-asset-actions">
            <button type="button" className="hub-chip-button" onClick={() => signal(watched ? "removed" : "watched", asset)} aria-pressed={watched} title={watched ? undefined : follow.title} aria-disabled={!watched && !follow.room}>{watched ? <><EyeOff size={12} aria-hidden="true" />Watching</> : <><Eye size={12} aria-hidden="true" />Add to what I’m watching</>}</button>
            <button type="button" className="hub-chip-button" onClick={() => ask(`What happened with ${asset.symbol} recently?`)}><MessageCircle size={12} aria-hidden="true" />What happened here?</button>
            <button type="button" className="hub-chip-button" onClick={() => ask(`Why did you surface ${asset.symbol}?`)}>Why did you surface this?</button>
            {state.profile.permission !== "notify" && <button type="button" className="hub-chip-button" onClick={() => { setDraft(`Buy $50 of ${asset.symbol}`); router.push("/"); }}>Ask my agent to buy $50…</button>}
          </div>
          {!watched && !follow.room && <p className="hub-limit-hint is-full" role="status">{follow.title} <Link className="hub-inline-link" href="/profile">Open profile</Link></p>}
        </section>
        <section className="hub-detail-facts" data-detail-part>
          <p className="hub-part-title">Market</p>
          <Facts>
            <Fact label="Market cap" value={asset.marketCap ? `$${compact(asset.marketCap)}` : "—"} />
            <Fact label="Volume" value={asset.volume ? compact(asset.volume) : "—"} />
            <Fact label="Themes" value={asset.themes.length ? asset.themes.slice(0, 4).join(", ") : "—"} />
            <Fact label="Source" value={asset.source} />
          </Facts>
          {asset.description && <p className="hub-detail-description">{asset.description}</p>}
        </section>
        {asset.kind === "crypto" && (asset.contracts ? <section data-detail-part><BuyPanel title={`Buy ${asset.symbol}`} preselected={{ symbol: asset.symbol, name: asset.name, contracts: asset.contracts }} /></section>
          : <section data-detail-part className="hub-detail-why"><p className="hub-part-title">Trade onchain</p><p>{asset.name} has no verified contract on a supported network (Ethereum, Base, Arbitrum, Optimism, Polygon), so it can’t be bought here. <Link className="hub-inline-link" href="/trade">Buy something else</Link></p></section>)}
        {asset.news.length > 0 && <section data-detail-part><NewsList title="Recent" items={asset.news} /></section>}
      </>}
    </div>
  );
}
