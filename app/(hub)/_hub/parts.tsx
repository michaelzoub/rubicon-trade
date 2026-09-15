"use client";

import { ArrowUpRight, Check, Eye, EyeOff, HelpCircle, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Asset, MessagePart, ProfileChange, TradeIntent } from "@/lib/socialtrading/types";
import { PERMISSIONS } from "@/lib/socialtrading/profile";
import { followedAssets, limitStatus } from "@/lib/socialtrading/plans";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { compact, pct, timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";
import { CryptoTradeCard } from "./crypto-trade-card";

export const assetHref = (asset: Pick<Asset, "kind" | "id">) => `/explore/${asset.kind}/${encodeURIComponent(asset.id)}`;

/** Tiny inline price history. Pure SVG so it can sit inside a chat row. */
export function Sparkline({ points, width = 96, height = 28, className = "" }: { points: { price: number }[]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return <span className={`hub-sparkline is-empty ${className}`} style={{ width, height }} aria-hidden="true" />;
  const prices = points.map(p => p.price), min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const d = prices.map((p, i) => `${i ? "L" : "M"}${(i / (prices.length - 1)) * width} ${height - 2 - ((p - min) / span) * (height - 4)}`).join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  return <svg className={`hub-sparkline ${up ? "is-up" : "is-down"} ${className}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function ChangeText({ value, className = "" }: { value: number | null; className?: string }) {
  const tone = value === null ? "" : value > 0 ? " is-up" : value < 0 ? " is-down" : "";
  return <span className={`hub-change${tone} ${className}`}>{pct(value)}</span>;
}

export function RelevanceLabel({ asset }: { asset: Pick<Asset, "label" | "labelTone"> }) {
  if (!asset.label) return null;
  return <span className={`hub-label hub-label--${asset.labelTone ?? "related"}`}>{asset.label}</span>;
}

function useEnter<T extends HTMLElement>(deps: unknown[] = []) {
  const root = useRef<T>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root.current, { opacity: 0, y: 8, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .4, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { scope: root, dependencies: deps });
  return root;
}

/** Whether one more follow fits the plan; when not, the sentence that explains it. Shared by cards and the detail page. */
export function useFollowRoom() {
  const { state, account } = useHub();
  if (!account) return { room: true, title: undefined as string | undefined };
  const status = limitStatus(account.limits, "follows", followedAssets(state.profile.interests));
  return { room: !status.atLimit, title: status.atLimit ? `You follow ${status.limit} assets, the most the ${account.planName} plan keeps. Unfollow one in your profile to follow this.` : status.nearLimit ? `${status.remaining} more ${status.remaining === 1 ? "asset" : "assets"} to follow on the ${account.planName} plan.` : undefined };
}

export function AssetCard({ asset, dense = false }: { asset: Asset; dense?: boolean }) {
  const { state, signal, send, busy } = useHub();
  const router = useRouter();
  const follow = useFollowRoom();
  const watched = state.profile.interests.some(i => i.id === asset.id || i.symbol?.toUpperCase() === asset.symbol.toUpperCase());
  function open() { signal("opened", asset); router.push(assetHref(asset)); }
  return (
    <article className={`hub-asset${dense ? " is-dense" : ""}`} data-asset={asset.symbol}>
      <button type="button" className="hub-asset-main" onClick={open} aria-label={`Open ${asset.name}`}>
        <span className="hub-asset-id"><strong>{asset.symbol}</strong><span>{asset.name}</span></span>
        <Sparkline points={asset.chart.slice(-40)} />
        <span className="hub-asset-price"><span>{usd(asset.price)}</span><ChangeText value={asset.change} /></span>
      </button>
      <div className="hub-asset-foot">
        <RelevanceLabel asset={asset} />
        {!dense && asset.reason && <p className="hub-asset-reason">{asset.reason}</p>}
        <div className="hub-asset-actions">
          <button type="button" className="hub-chip-button" onClick={() => signal(watched ? "removed" : "watched", asset)} aria-pressed={watched} data-tooltip={watched ? undefined : follow.title} aria-disabled={!watched && !follow.room}>
            {watched ? <><EyeOff size={12} aria-hidden="true" />Watching</> : <><Eye size={12} aria-hidden="true" />Watch</>}
          </button>
          <button type="button" className="hub-chip-button" disabled={busy} onClick={() => { signal("followup", asset); void send(`Why did you surface ${asset.symbol}?`); }}><HelpCircle size={12} aria-hidden="true" />Why this?</button>
          <button type="button" className="hub-chip-button" onClick={() => signal("dismissed", asset)} aria-label={`Not interested in ${asset.symbol}`}><X size={12} aria-hidden="true" />Not for me</button>
        </div>
      </div>
    </article>
  );
}

export function AssetLogo({ asset }: { asset: Pick<Asset, "symbol" | "logo"> }) {
  const [failed, setFailed] = useState(false);
  const hue = [...asset.symbol].reduce((n, c) => n + c.charCodeAt(0), 0) * 47 % 360;
  return <span className="hub-asset-logo" style={{ background: `hsl(${hue} 65% 93%)`, color: `hsl(${hue} 45% 34%)` }}>
    {asset.logo && !failed ? <img src={asset.logo} alt="" onError={() => setFailed(true)} /> : asset.symbol.slice(0, 2)}
  </span>;
}

function DiscoveryCard({ asset }: { asset: Asset }) {
  const { state, signal, send, busy } = useHub();
  const router = useRouter();
  const follow = useFollowRoom();
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const watched = state.profile.interests.some(i => i.id === asset.id || i.symbol?.toUpperCase() === asset.symbol.toUpperCase());
  async function act(action: "watched" | "removed" | "dismissed") {
    setPending(true); const saved = await signal(action, asset); if (saved && action === "dismissed") setDismissed(true); setPending(false);
  }
  if (dismissed) return null;
  return <article className="hub-discovery-card" data-asset={asset.symbol}>
    <Link className="hub-discovery-main" href={assetHref(asset)} onClick={() => { void signal("opened", asset); }} aria-label={`Open ${asset.name}`}>
      <AssetLogo asset={asset} />
      <span className="hub-discovery-price"><strong>{asset.price == null ? "Price unavailable" : usd(asset.price)}</strong><small>{asset.marketCap ? `$${compact(asset.marketCap)} market cap` : asset.kind === "crypto" ? "Crypto" : "Stock"}</small></span>
      <span className="hub-discovery-name"><strong>{asset.name}</strong><small>{asset.symbol} <ChangeText value={asset.change} /></small></span>
      {asset.description && <p className="hub-discovery-description">{asset.description}</p>}
    </Link>
    <div className="hub-discovery-actions">
      <button type="button" className="hub-chip-button" disabled={pending || busy || (!watched && !follow.room)} data-tooltip={follow.title} aria-pressed={watched} onClick={() => void act(watched ? "removed" : "watched")}>{watched ? <Check size={14} /> : <Eye size={14} />}{watched ? "Watching" : "Watch"}</button>
      <button type="button" className="hub-chip-button" disabled={busy || pending} onClick={() => { router.push("/"); void send(`Tell me about ${asset.name} (${asset.symbol}) and why it might interest me.`); }}>Ask agent</button>
      <button type="button" className="hub-discovery-dismiss" disabled={pending || busy} data-tooltip="Not for me" aria-label={`Not interested in ${asset.symbol}`} onClick={() => void act("dismissed")}><X size={15} /></button>
    </div>
  </article>;
}

export function AssetGrid({ assets, title, dense, discovery = false }: { assets: Asset[]; title?: string; dense?: boolean; discovery?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { state } = useHub();
  const visible = discovery ? assets.filter(a => {
    const latest = [...state.signals].reverse().find(s => s.target === (a.kind === "crypto" ? a.id : a.symbol) && ["dismissed", "watched", "removed"].includes(s.action));
    return latest?.action !== "dismissed";
  }) : assets;
  const key = visible.map(a => a.id).join(",");
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-asset]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .38, stagger: .05, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [key], revertOnUpdate: true });
  if (!assets.length) return null;
  return <section ref={root} className="hub-assets">
    {title && <p className="hub-part-title">{title}</p>}
    <div className={discovery ? "hub-discovery-grid" : "hub-asset-grid"}>{visible.map(asset => discovery ? <DiscoveryCard key={`${asset.kind}:${asset.id}`} asset={asset} /> : <AssetCard key={`${asset.kind}:${asset.id}`} asset={asset} dense={dense} />)}</div>{discovery && !visible.length && <p className="hub-empty" role="status">All caught up. Try another category to discover more.</p>}
  </section>;
}

export function ProfileUpdateCard({ changes }: { changes: ProfileChange[] }) {
  const root = useEnter<HTMLDivElement>();
  return <div ref={root} className="hub-update" role="status">
    <p className="hub-part-title"><Check size={12} aria-hidden="true" />Profile updated</p>
    <ul>{changes.map((c, i) => <li key={i}><span>{c.label}</span>{(c.before || c.after) && <span className="hub-update-diff">{c.before && <s>{c.before}</s>}{c.after && <b>{c.after}</b>}</span>}</li>)}</ul>
    <Link href="/profile" className="hub-inline-link">See your profile<ArrowUpRight size={12} aria-hidden="true" /></Link>
  </div>;
}

export function ExplanationCard({ reasons, target }: { reasons: string[]; target?: string }) {
  const root = useEnter<HTMLDivElement>();
  return <div ref={root} className="hub-explain">
    <p className="hub-part-title">Why {target ?? "this"} showed up</p>
    <ol>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ol>
  </div>;
}

export function NewsList({ items, title }: { items: Asset["news"]; title?: string }) {
  if (!items.length) return null;
  return <div className="hub-news">
    {title && <p className="hub-part-title">{title}</p>}
    <ul>{items.map(n => <li key={n.url}><a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}<ArrowUpRight size={12} aria-hidden="true" /></a><span>{[n.source, timeAgo(n.publishedAt)].filter(Boolean).join(" · ")}</span></li>)}</ul>
  </div>;
}

const TRADE_STATUS: Record<TradeIntent["status"], string> = {
  blocked: "Not allowed", approval_required: "Waiting for you", reserved: "Approved · reserving", submitted: "Sent to Robinhood",
  confirmed: "Filled", rejected: "Declined", failed: "Failed", unknown: "Status unknown",
};
export { TRADE_STATUS };

export function TradeCard({ tradeId }: { tradeId: string }) {
  const { state, mutate } = useHub();
  const trade = state.trades.find(t => t.id === tradeId);
  const root = useEnter<HTMLDivElement>();
  const status = useRef<HTMLSpanElement>(null);
  const previous = useRef(trade?.status);
  useEffect(() => {
    if (!trade || previous.current === trade.status) return;
    previous.current = trade.status;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    gsap.fromTo(status.current, { opacity: 0, y: -4 }, { opacity: 1, y: 0, duration: .3, ease: rubiconMotion.ease.enter, clearProps: "all" });
  }, [trade]);
  if (!trade) return <div className="hub-notice">This trade is no longer available.</div>;
  if (trade.crypto) return <CryptoTradeCard trade={trade} />;
  const pending = trade.status === "approval_required";
  const connected = state.brokerage?.connected ?? false;
  return <div ref={root} className={`hub-trade is-${trade.status}`} role="group" aria-label="Trade confirmation">
    <div className="hub-trade-head">
      <p className="hub-part-title">{trade.side === "buy" ? "Buy" : "Sell"} {trade.asset.symbol}</p>
      <span ref={status} className="hub-trade-status">{TRADE_STATUS[trade.status]}</span>
    </div>
    <dl className="hub-trade-facts">
      <div><dt>Asset</dt><dd>{trade.asset.name}</dd></div>
      <div><dt>Side</dt><dd>{trade.side === "buy" ? "Buy" : "Sell"}</dd></div>
      <div><dt>Value</dt><dd>{usd(trade.value, 2)}</dd></div>
      <div><dt>Est. price</dt><dd>{usd(trade.estimatedPrice)}</dd></div>
      <div><dt>Est. quantity</dt><dd>{trade.estimatedQuantity === null ? "—" : trade.estimatedQuantity.toLocaleString("en-US", { maximumFractionDigits: 6 })}</dd></div>
      <div><dt>Resulting exposure</dt><dd>{usd(trade.resultingExposure, 2)}</dd></div>
    </dl>
    <p className="hub-trade-policy">{trade.policy.reason} <span>· {PERMISSIONS[state.profile.permission]}</span></p>
    {trade.reasoning && <p className="hub-trade-reasoning">{trade.reasoning}</p>}
    {!connected && trade.status !== "blocked" && trade.status !== "rejected" && <p className="hub-notice">Robinhood isn’t connected yet, so nothing will be placed. Approving records your decision; the order is sent once you connect.</p>}
    {pending && <div className="hub-trade-actions">
      <button type="button" className="button button-primary" onClick={() => void mutate({ action: "trade", tradeId, decision: "approved" })}>Approve</button>
      <button type="button" className="button button-secondary" onClick={() => void mutate({ action: "trade", tradeId, decision: "rejected" })}>Not now</button>
    </div>}
    {trade.brokerage?.detail && <p className="hub-trade-brokerage">{trade.brokerage.detail}</p>}
  </div>;
}

export function PartView({ part }: { part: MessagePart }) {
  switch (part.type) {
    case "text": return <p className="hub-text">{part.text}</p>;
    case "assets": return <AssetGrid assets={part.assets} title={part.title} dense={part.assets.length > 2} />;
    case "asset": return <AssetGrid assets={[part.asset]} />;
    case "profile_update": return <ProfileUpdateCard changes={part.changes} />;
    case "explanation": return <ExplanationCard reasons={part.reasons} target={part.target} />;
    case "trade": return <TradeCard tradeId={part.tradeId} />;
    case "news": return <NewsList items={part.items} title={part.title} />;
    case "notice": return <p className="hub-notice" role="status">{part.text}</p>;
  }
}

export function Facts({ children }: { children: ReactNode }) { return <dl className="hub-facts">{children}</dl>; }
export function Fact({ label, value }: { label: string; value: ReactNode }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
export { compact };
