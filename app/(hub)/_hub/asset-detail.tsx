"use client";

import { ArrowLeft, Eye, EyeOff, MessageCircle } from "lucide-react";
import { HubLink as Link } from "./navigation";
import { useHubRouter as useRouter } from "./navigation";
import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { gsap, useGSAP, prefersReducedMotion, rubiconMotion } from "../../_components/motion";
import { compact, timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";
import { Lens } from "./lens";
import { ChangePill, Fact, Facts, NewsList, RelevanceLabel, useFollowRoom } from "./parts";
import { PriceTrace, type TraceHit } from "./price-trace";
import { openPurchase } from "./purchase";

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
  const [hit, setHit] = useState<TraceHit | null>(null);
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
  const data = asset?.chart ?? [];
  const read = hit ? data[hit.index] : null;
  const when = (time: number) => new Intl.DateTimeFormat("en-US", days <= 7 ? { weekday: "short", hour: "numeric" } : { month: "short", day: "numeric" }).format(new Date(time));
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
    const line = plot.current?.querySelector<SVGPathElement>(".trace-line");
    if (!asset || data.length < 2 || !line || prefersReducedMotion()) { settle(); return; }

    const fill = plot.current?.querySelector<SVGPathElement>(".trace-area");
    const length = line.getTotalLength();
    const tl = gsap.timeline({ onComplete: settle });
    tl.fromTo(line, { strokeDasharray: length, strokeDashoffset: length },
      { strokeDashoffset: 0, duration: .95, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" });
    if (fill) tl.fromTo(fill, { opacity: 0, transformOrigin: "50% 100%", scaleY: .82 }, { opacity: 1, scaleY: 1, duration: .7, ease: rubiconMotion.ease.enter, clearProps: "all" }, .2);
    tl.fromTo(plot.current!.querySelectorAll(".hub-plot-axis span"), { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: .4, stagger: .05, clearProps: "all" }, .15);
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
          <div className={`hub-detail-price${read ? " is-reading" : ""}`}>
            <strong ref={priceNode}>{usd(read ? read.price : asset.price)}</strong>
            <ChangePill value={asset.change} />
            <small>{read ? when(read.time) : asset.asOf ? `as of ${timeAgo(asset.asOf)}` : ""}</small>
            <button type="button" className="hub-buy-primary" onClick={() => openPurchase({ asset })}>Buy {asset.symbol} <span aria-hidden="true">↗</span></button>
          </div>
        </header>
        <section className="hub-detail-chart" data-detail-part aria-label="Price history">
          <Lens items={RANGES} value={range} onChange={setRange} label="Chart range" className="hub-range-lens" />
          {data.length > 1 ? <div ref={plot} className="hub-plot">
            <PriceTrace points={data} height={300} pad={{ top: 28, bottom: 18 }} onScrub={setHit} label={`${asset.name} price over the last ${range === "365" ? "year" : `${days} days`}`} />
            {read && hit && <span className={`trace-chip is-large${hit.y < 64 ? " is-below" : ""}`} style={{ left: Math.min(Math.max(hit.x, 90), hit.width - 90), top: hit.y < 64 ? hit.y + 16 : hit.y - 14 }}><small>{when(read.time)}</small><b>{usd(read.price)}</b></span>}
            <div className="hub-plot-axis" aria-hidden="true">
              <span>{when(data[0].time)}</span>
              {read && hit && <span className="hub-plot-cursor" style={{ left: hit.x }}>{when(read.time)}</span>}
              <span>{when(data[data.length - 1].time)}</span>
            </div>
          </div> : <p className="hub-notice">No price history is available for this range.</p>}
        </section>
        <section className="hub-detail-why" data-detail-part>
          <p className="hub-part-title">Why this matters to you</p>
          <p>{asset.reason}</p>
          <div className="hub-asset-actions">
            <button type="button" className="hub-chip-button" onClick={() => signal(watched ? "removed" : "watched", asset)} aria-pressed={watched} data-tooltip={watched ? undefined : follow.title} aria-disabled={!watched && !follow.room}>{watched ? <><EyeOff size={12} aria-hidden="true" />Watching</> : <><Eye size={12} aria-hidden="true" />Add to what I’m watching</>}</button>
            <button type="button" className="hub-chip-button" onClick={() => ask(`What happened with ${asset.symbol} recently?`)}><MessageCircle size={12} aria-hidden="true" />What happened here?</button>
            {state.profile.permission !== "notify" && <button type="button" className="hub-chip-button" onClick={() => openPurchase({ asset, amount: "50" })}>Buy $50…</button>}
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
        {asset.news.length > 0 && <section data-detail-part><NewsList title="Recent" items={asset.news} /></section>}
      </>}
    </div>
  );
}
