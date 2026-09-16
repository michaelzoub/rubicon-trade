"use client";

import { ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import { HubLink as Link } from "./navigation";
import { useHubRouter as useRouter } from "./navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Asset } from "@/lib/socialtrading/types";
import { ChartFrame, ChartTooltip } from "../../_components/charts";
import { gsap, useGSAP, prefersReducedMotion, rubiconMotion } from "../../_components/motion";
import { compact, timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";
import { Lens } from "./lens";
import { ChangeText, Fact, Facts, NewsList, RelevanceLabel, useFollowRoom } from "./parts";
import { BuyPanel } from "./buy-panel";

const RANGES = [
  { id: "7", label: "7D", hue: "#2f80ed" },
  { id: "30", label: "30D", hue: "#2f80ed" },
  { id: "90", label: "90D", hue: "#2f80ed" },
  { id: "365", label: "1Y", hue: "#2f80ed" },
] as const;
type RangeId = typeof RANGES[number]["id"];

export function AssetDetail({ kind, id }: { kind: Asset["kind"]; id: string }) {
  const { market, state, signal, send, setDraft } = useHub();
  const router = useRouter();
  const [range, setRange] = useState<RangeId>("30");
  const days = Number(range);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const priceNode = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const gradient = useId().replace(/:/g, "");
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
  /** The chart draws itself, and the headline price travels from where the
   * range started to where it is now. Switching range replays both, so the
   * change reads as something happening rather than a swap.
   *
   * The price element is written by the tween, so every exit path — finished,
   * interrupted, reduced motion, no data — has to leave the true price behind.
   * `settle` is that guarantee; GSAP’s own revert would rewind it to the start.
   */
  useGSAP(() => {
    const node = priceNode.current;
    const settle = () => { if (node && asset?.price != null) node.textContent = usd(asset.price); };
    const line = plot.current?.querySelector<SVGPathElement>(".recharts-area-curve");
    if (!asset || data.length < 2 || !line || prefersReducedMotion()) { settle(); return; }

    const fill = plot.current?.querySelector<SVGPathElement>(".recharts-area-area");
    const length = line.getTotalLength();
    const tl = gsap.timeline({ onComplete: settle });
    tl.fromTo(line, { strokeDasharray: length, strokeDashoffset: length },
      { strokeDashoffset: 0, duration: .95, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" });
    if (fill) tl.fromTo(fill, { opacity: 0, transformOrigin: "50% 100%", scaleY: .82 }, { opacity: 1, scaleY: 1, duration: .7, ease: rubiconMotion.ease.enter, clearProps: "all" }, .2);
    tl.fromTo(plot.current!.querySelectorAll(".recharts-cartesian-axis-tick"), { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: .4, stagger: .02, clearProps: "all" }, .15);
    if (node && asset.price != null) {
      const counter = { value: data[0].price };
      tl.to(counter, { value: asset.price, duration: .95, ease: "power2.inOut", onUpdate: () => { node.textContent = usd(counter.value); } }, 0);
    }
    return () => { tl.kill(); settle(); };
    // `data` is derived from these; the fingerprint catches a new series of the same length.
  }, { scope: plot, dependencies: [asset?.id, asset?.price, days, data.length, data[0]?.time] });

  const ask = (text: string) => { if (asset) signal("followup", asset); setDraft(""); router.push("/"); void send(text); };

  return (
    <div ref={stage} className="hub-detail">
      <Link href="/explore" className="hub-back"><ArrowLeft size={14} aria-hidden="true" />Explore</Link>
      {error && <p className="hub-error" role="alert">{error}</p>}
      {!asset && !error && <div className="hub-skeleton-grid" role="status" aria-label="Loading asset"><span className="rubicon-skeleton hub-skeleton" /><span className="rubicon-skeleton hub-skeleton" /></div>}
      {asset && <>
        <header className="hub-detail-head" data-detail-part>
          <div>
            <p className="hub-detail-symbol mono">{asset.symbol}</p>
            <h1 className="landing-section-title">{asset.name}</h1>
            <RelevanceLabel asset={asset} />
          </div>
          <div className="hub-detail-price">
            <strong ref={priceNode}>{usd(asset.price)}</strong>
            <ChangeText value={asset.change} />
            {asset.asOf && <small>as of {timeAgo(asset.asOf)}</small>}
          </div>
        </header>
        <section className="hub-detail-chart" data-detail-part aria-label="Price history">
          <Lens items={RANGES} value={range} onChange={setRange} label="Chart range" className="hub-range-lens" />
          {data.length > 1 ? <div ref={plot} className="hub-plot"><ChartFrame height={260}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
                <defs>
                  <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--hub-blue)" stopOpacity={.24} />
                    <stop offset="100%" stopColor="var(--hub-blue)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" axisLine={{ stroke: "var(--line)" }} tickLine={false} interval="preserveStartEnd" minTickGap={48} tick={{ fill: "var(--quiet)", fontSize: 10 }} tickMargin={9} />
                <YAxis axisLine={false} tickLine={false} width={56} domain={[min, max]} tick={{ fill: "var(--quiet)", fontSize: 10 }} tickFormatter={v => usd(v, Math.abs(v) < 1 ? 4 : 0)} tickCount={4} orientation="right" />
                <Tooltip cursor={{ stroke: "var(--hub-blue)", strokeWidth: 1, strokeDasharray: "3 3" }} isAnimationActive={false} wrapperStyle={{ outline: "none", pointerEvents: "none" }}
                  content={({ active, payload }) => active && payload?.length ? <ChartTooltip label={new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: days <= 7 ? "short" : undefined }).format(new Date((payload[0].payload as { time: number }).time))} value={usd((payload[0].payload as { price: number }).price)} /> : null} />
                <Area type="monotone" dataKey="price" stroke="var(--hub-blue)" strokeWidth={1.75} fill={`url(#${gradient})`} dot={false}
                  activeDot={{ r: 4, fill: "var(--hub-blue)", stroke: "white", strokeWidth: 2 }} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartFrame></div> : <p className="hub-notice">No price history is available for this range.</p>}
        </section>
        <section className="hub-detail-why" data-detail-part>
          <p className="hub-part-title">Why this matters to you</p>
          <p>{asset.reason}</p>
          <div className="hub-asset-actions">
            <button type="button" className="hub-chip-button" onClick={() => signal(watched ? "removed" : "watched", asset)} aria-pressed={watched} data-tooltip={watched ? undefined : follow.title} aria-disabled={!watched && !follow.room}>{watched ? <><EyeOff size={12} aria-hidden="true" />Watching</> : <><Eye size={12} aria-hidden="true" />Add to what I’m watching</>}</button>
            <button type="button" className="hub-chip-button" onClick={() => ask(`What happened with ${asset.symbol} recently?`)}><MessageCircle size={12} aria-hidden="true" />What happened here?</button>
            {state.profile.permission !== "notify" && <button type="button" className="hub-chip-button" onClick={() => { setDraft(`Buy $50 of ${asset.symbol}`); router.push("/"); }}>Ask my agent to buy $50…</button>}
          </div>
          {!watched && !follow.room && <p className="hub-limit-hint is-full" role="status">{follow.title} <Link className="hub-inline-link" href="/profile">Open profile</Link></p>}
        </section>
        {/* The numbers most people never read, and the prompt for the ones who
          * do. Folded away so the page answers "what is this and why me?" first. */}
        <details className="hub-disclosure hub-detail-facts" data-detail-part>
          <summary>More about {asset.symbol}</summary>
          <div className="hub-disclosure-body">
            <Facts>
              <Fact label="Market cap" value={asset.marketCap ? `$${compact(asset.marketCap)}` : "—"} />
              <Fact label="Volume" value={asset.volume ? compact(asset.volume) : "—"} />
              <Fact label="Themes" value={asset.themes.length ? asset.themes.slice(0, 4).join(", ") : "—"} />
              <Fact label="Source" value={asset.source} />
            </Facts>
            {asset.description && <p className="hub-detail-description">{asset.description}</p>}
            <button type="button" className="hub-chip-button" onClick={() => ask(`Why did you surface ${asset.symbol}?`)}>Why did you surface this?</button>
          </div>
        </details>
        {asset.kind === "crypto" && (asset.contracts ? <section data-detail-part><BuyPanel title={`Buy ${asset.symbol}`} preselected={{ symbol: asset.symbol, name: asset.name, contracts: asset.contracts }} /></section>
          : <section data-detail-part className="hub-detail-why"><p className="hub-part-title">Trade onchain</p><p>{asset.name} has no verified contract on a supported network (Ethereum, Base, Arbitrum, Optimism, Polygon), so it can’t be bought here. <Link className="hub-inline-link" href="/trade">Buy something else</Link></p></section>)}
        {asset.news.length > 0 && <section data-detail-part><NewsList title="Recent" items={asset.news} /></section>}
      </>}
    </div>
  );
}
