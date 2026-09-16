"use client";

import { useRef } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { usd } from "./format";
import { useHub } from "./hub-provider";
import { HubLink as Link } from "./navigation";
import { AssetLogo, assetHref, ChangeText } from "./parts";

/** How many opportunities the field holds. Enough to read as a landscape
 * rather than a handful of picks, few enough to stay legible. */
const MAX = 10;

/** Roughly what one card occupies, as a share of the stage, so cards can be
 * pushed apart without measuring the DOM. */
const CARD = { w: 16, h: 17 };

/** Stocks and coins in one field, best-ranked first. */
export function constellation(list: Asset[]): Asset[] {
  const stocks = list.filter(a => a.kind === "stock"), coins = list.filter(a => a.kind === "crypto");
  const picked: Asset[] = [];
  for (let i = 0; i < Math.max(stocks.length, coins.length) && picked.length < MAX; i++) {
    if (stocks[i]) picked.push(stocks[i]);
    if (coins[i] && picked.length < MAX) picked.push(coins[i]);
  }
  return picked.slice(0, MAX);
}

const TONE_STRENGTH: Record<string, number> = { match: 1, related: .72, emerging: .55, explore: .4, muted: .2, ignored: 0 };

/** How close this is to what the person believes. The agent's own score wins;
 * without one, the label it chose stands in. */
export function fit(asset: Asset): number {
  if (typeof asset.score === "number") return asset.score;
  return TONE_STRENGTH[asset.labelTone ?? "related"] ?? .5;
}

export type Placed = { asset: Asset; x: number; y: number; fit: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The usable field, as the top-left corner of a card. Leaves room for the
 * card itself plus the axis labels at the edges. */
const X = { lo: 1, hi: 80 }, Y = { lo: 1, hi: 80 };

/**
 * Two questions, two axes: how far it has moved today (left to right) and how
 * closely it matches the thesis (bottom to top). Positions come from the data,
 * then a short relaxation pass pushes overlapping cards apart so the field
 * stays readable without lying about where anything sits.
 */
export function plot(assets: Asset[]): Placed[] {
  if (!assets.length) return [];
  const moves = assets.map(a => a.change ?? 0);
  const fits = assets.map(fit);
  const spread = (values: number[]) => {
    const lo = Math.min(...values), hi = Math.max(...values);
    const span = hi - lo;
    // With nothing to separate them, lay them out evenly rather than stacking.
    return (value: number, i: number) => span > 1e-6 ? (value - lo) / span : (values.length > 1 ? i / (values.length - 1) : .5);
  };
  const acrossAt = spread(moves), upAt = spread(fits);
  const nodes: Placed[] = assets.map((asset, i) => ({
    asset, fit: fits[i],
    x: 4 + acrossAt(moves[i], i) * 78,
    y: 74 - upAt(fits[i], i) * 66,
  }));

  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      // Nudge exact ties apart so the push below has a direction to work with.
      const dx = b.x - a.x || (j - i) * 1e-3, dy = b.y - a.y || (j - i) * 1e-3;
      const overX = CARD.w - Math.abs(dx), overY = CARD.h - Math.abs(dy);
      if (overX <= 0 || overY <= 0) continue;
      moved = true;
      // Give way along whichever axis is closer to clearing, so cards drift the
      // shortest distance from where their data put them.
      if (overX / CARD.w <= overY / CARD.h) { const push = Math.sign(dx) * overX * .55; a.x -= push; b.x += push; }
      else { const push = Math.sign(dy) * overY * .55; a.y -= push; b.y += push; }
    }
    // Stay on the stage while relaxing, not only at the end: clamping once at
    // the finish would squash cards back into the overlaps just resolved.
    for (const node of nodes) { node.x = clamp(node.x, X.lo, X.hi); node.y = clamp(node.y, Y.lo, Y.hi); }
    if (!moved) break;
  }
  return nodes;
}

/**
 * The Explore hero: opportunities laid out as a field, brightest and highest
 * being the ones that match what you believe. They breathe, follow the pointer
 * by depth, and on scroll draw together and fade so the ordered grid takes over.
 */
export function Constellation({ assets }: { assets: Asset[] }) {
  const root = useRef<HTMLDivElement>(null);
  const { signal } = useHub();
  const placed = plot(assets);
  const key = assets.map(a => a.id).join(",");

  useGSAP(() => {
    const stage = root.current;
    if (!stage) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const slots = gsap.utils.toArray<HTMLElement>("[data-orbit]", stage);
      const gathers = gsap.utils.toArray<HTMLElement>("[data-orbit-gather]", stage);
      const floats = gsap.utils.toArray<HTMLElement>("[data-orbit-float]", stage);

      gsap.fromTo(floats, { opacity: 0, y: 30, scale: .9, filter: "blur(8px)" }, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: .85, stagger: .055, ease: rubiconMotion.ease.enter, clearProps: "filter" });
      floats.forEach((el, i) => gsap.to(el, { y: 2.5 + (i % 3) * 1.5, duration: 4.2 + (i % 5) * .4, yoyo: true, repeat: -1, ease: "sine.inOut", delay: .9 }));

      const xs = slots.map(s => gsap.quickTo(s, "x", { duration: .5, ease: "power2.out" }));
      const ys = slots.map(s => gsap.quickTo(s, "y", { duration: .5, ease: "power2.out" }));
      const move = (event: PointerEvent) => {
        const r = stage.getBoundingClientRect();
        const nx = ((event.clientX - r.left) / r.width - .5) * 2, ny = ((event.clientY - r.top) / r.height - .5) * 2;
        // A few pixels only: the card’s place on the axes is the information.
        slots.forEach((s, i) => { const d = Number(s.dataset.depth); xs[i](nx * 5 * d); ys[i](ny * 3.5 * d); });
      };
      const rest = () => slots.forEach((_, i) => { xs[i](0); ys[i](0); });
      stage.addEventListener("pointermove", move); stage.addEventListener("pointerleave", rest);

      const rect = stage.getBoundingClientRect();
      const tl = gsap.timeline({ scrollTrigger: { trigger: stage, start: 0, end: 520, scrub: .6, onUpdate: self => stage.classList.toggle("is-collapsed", self.progress > .8) } });
      gathers.forEach((g, i) => {
        const gr = g.getBoundingClientRect(), d = Number(slots[i].dataset.depth);
        const dx = rect.left + rect.width / 2 - (gr.left + gr.width / 2), dy = rect.top + rect.height / 2 - (gr.top + gr.height / 2);
        tl.to(g, { x: dx * .6, y: dy * .6 - 26 * d, scale: .7, opacity: 0, filter: "blur(8px)", ease: "none" }, 0);
      });
      tl.to("[data-orbit-glow], [data-orbit-axis]", { opacity: 0, ease: "none" }, 0);
      return () => { stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerleave", rest); };
    });
    return () => media.revert();
  }, { scope: root, dependencies: [key], revertOnUpdate: true });

  return <div ref={root} className="hub-constellation"
    aria-label="Picked for you, placed by how far each has moved today and how closely it matches your thesis">
    <span className="hub-constellation-glow is-one" data-orbit-glow aria-hidden="true" />
    <span className="hub-constellation-glow is-two" data-orbit-glow aria-hidden="true" />
    <div className="hub-field-axes" data-orbit-axis aria-hidden="true">
      <span className="hub-field-rule is-vertical" /><span className="hub-field-rule is-horizontal" />
      <span className="hub-field-tick is-top">Closer to your thesis</span>
      <span className="hub-field-tick is-left">Down today</span>
      <span className="hub-field-tick is-right">Up today</span>
    </div>
    {placed.map(({ asset, x, y, fit: strength }) => {
      // Stronger matches sit further forward, so they move most and cast most light.
      const depth = .7 + strength * .6;
      const match = asset.labelTone === "match";
      return <div key={`${asset.kind}:${asset.id}`} data-orbit data-depth={depth} className="hub-orbit" style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(depth * 10) }}>
        <div data-orbit-gather className="hub-orbit-gather">
          <div data-orbit-float className="hub-orbit-float" style={{ "--depth": depth } as React.CSSProperties}>
            <Link href={assetHref(asset)} className={`hub-orbit-card${match ? " is-match hub-priority-card" : ""}`} onClick={() => { void signal("opened", asset); }}
              aria-label={`Open ${asset.name}${match ? ", a strong match for your thesis" : ""}`}>
              <AssetLogo asset={asset} />
              <span className="hub-orbit-id"><strong>{asset.symbol}</strong><small>{usd(asset.price)}</small></span>
              <ChangeText value={asset.change} />
            </Link>
          </div>
        </div>
      </div>;
    })}
  </div>;
}
