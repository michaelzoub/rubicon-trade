"use client";

import { useEffect, useRef, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { gsap, useGSAP, prefersReducedMotion } from "../../_components/motion";
import { pct } from "./format";
import { useHub } from "./hub-provider";
import { PriceTrace } from "./price-trace";
import { AssetLogo } from "./parts";
import "./buy-ticker.css";

/** How often the price is read again. Long enough that the ring is calm, short
 * enough that the number under it is still true when someone presses Buy. */
const REFRESH = 60_000;
const RING = 2 * Math.PI * 9;

/** A price at the scale it is actually read at: dollars to the cent, fractions
 * of a cent when that is what the thing costs. */
const price = (value: number) => new Intl.NumberFormat("en-US", {
  minimumFractionDigits: value >= 1 ? 2 : value >= 0.01 ? 4 : 6,
  maximumFractionDigits: value >= 1 ? 2 : value >= 0.01 ? 4 : 6,
}).format(value);

/**
 * The thing you are about to own, as a live instrument.
 *
 * One plate: who it is, what it has done this week, what it costs right now.
 * The trace runs under the number rather than beside it, so the price reads as
 * the end of that line instead of a figure in a table — and the ring in the
 * corner says, without a sentence, that the number keeps itself honest.
 */
export function BuyTicker({ chainId, contract, symbol, name, logo, seedPrice, onPrice }: {
  chainId: number; contract: string; symbol: string; name: string; logo?: string;
  seedPrice?: number | null;
  /** The panel needs the same number to estimate what the money buys. */
  onPrice?: (value: number | null) => void;
}) {
  const { market } = useHub();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [remaining, setRemaining] = useState(REFRESH / 1000);
  const plate = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    setAsset(null); setLoading(true); shown.current = null;
    const read = async () => {
      try {
        const [next] = await market({ kind: "token", chainId: String(chainId), contract, days: "7" });
        if (live && next) { setAsset(next); setRemaining(REFRESH / 1000); }
      } catch { /* the last good number stays on screen */ }
      finally { if (live) setLoading(false); }
    };
    void read();
    const cycle = setInterval(read, REFRESH);
    const tick = setInterval(() => setRemaining(seconds => (seconds <= 1 ? REFRESH / 1000 : seconds - 1)), 1000);
    return () => { live = false; clearInterval(cycle); clearInterval(tick); };
  }, [market, chainId, contract]);

  const value = asset?.price ?? seedPrice ?? null;
  const change = asset?.change ?? null;
  const points = asset?.chart ?? [];
  const tone = change == null ? "blue" : change >= 0 ? "up" : "down";
  useEffect(() => { onPrice?.(value ?? null); }, [value, onPrice]);

  // A new price arrives by counting to itself. Every other number in Rubicon
  // that changes under you does the same, and it is the only way a refresh is
  // visible without a flash that asks to be looked at.
  useGSAP(() => {
    const node = figure.current;
    if (!node || value == null) return;
    const from = shown.current;
    shown.current = value;
    if (from === null || from === value || prefersReducedMotion()) { node.textContent = price(value); return; }
    const counter = { value: from };
    gsap.to(counter, { value, duration: .7, ease: "power2.out", onUpdate: () => { node.textContent = price(counter.value); } });
  }, { dependencies: [value] });

  // The plate arrives as one object, under the header that names it.
  useGSAP(() => {
    gsap.fromTo(plate.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5, ease: "power3.out", clearProps: "all" });
  }, { scope: plate, dependencies: [symbol] });

  const left = Math.round(remaining);
  return <div ref={plate} className={`buy-ticker tone-${tone}`}>
    <div className="buy-ticker-id">
      <AssetLogo asset={{ symbol: symbol.toUpperCase(), logo }} />
      <p><strong>{symbol.toUpperCase()}</strong><span>{name}</span></p>
      <span className="buy-ticker-refresh" aria-label={`Price refreshes in ${left} seconds`}>
        <svg viewBox="0 0 22 22" width="22" height="22" aria-hidden="true">
          <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="1.5" />
          <circle cx="11" cy="11" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray={RING} strokeDashoffset={RING * (1 - left / (REFRESH / 1000))} transform="rotate(-90 11 11)" />
        </svg>
        <em>0:{String(left).padStart(2, "0")}</em>
      </span>
    </div>

    <div className="buy-ticker-trace" aria-hidden={points.length > 1 ? undefined : true}>
      {points.length > 1
        ? <PriceTrace points={points} height={96} scrub={false} tone={tone} pad={{ top: 14, bottom: 12 }} label={`${symbol.toUpperCase()} price, last 7 days`} />
        : loading ? <span className="rubicon-skeleton buy-ticker-trace-wait" /> : null}
    </div>

    <p className="buy-ticker-price">
      {value == null
        ? loading ? <span className="rubicon-skeleton buy-ticker-price-wait" /> : <span className="buy-ticker-unknown">Price unavailable</span>
        : <><span className="buy-ticker-currency" aria-hidden="true">$</span><span ref={figure}>{price(value)}</span></>}
    </p>
    <p className="buy-ticker-delta">
      {change == null ? <span className="is-quiet">Last 7 days</span> : <><span className={change >= 0 ? "is-up" : "is-down"}>{pct(change)}</span> today</>}
    </p>
  </div>;
}
