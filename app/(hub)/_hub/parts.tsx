"use client";
import { BridgeTradeCard } from "./bridge-trade-card";
import { openPurchase } from "./purchase";
import { tradability } from "@/lib/crypto/tradable";

import { ArrowUpRight, Check, Eye, EyeOff, HelpCircle, X } from "lucide-react";
import { HubLink as Link } from "./navigation";
import { useHubRouter as useRouter } from "./navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Asset, MessagePart, ProfileChange, TradeIntent } from "@/lib/socialtrading/types";
import { PERMISSIONS } from "@/lib/socialtrading/profile";
import { followedAssets, limitStatus } from "@/lib/socialtrading/plans";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { compact, pct, timeAgo, usd } from "./format";
import { assetGloss, useGloss } from "./gloss";
import { useHub } from "./hub-provider";
import { CryptoTradeCard } from "./crypto-trade-card";
import { PriceTrace, traceDate, type TraceHit } from "./price-trace";
import { useMarketAsset } from "./market-quote";

export const assetHref = (asset: Pick<Asset, "kind" | "id">) => `/explore/${asset.kind}/${encodeURIComponent(asset.id)}`;

/** Tiny inline price history. Pure SVG so it can sit inside a chat row. */
export function Sparkline({ points, width = 96, height = 28, className = "" }: { points: { price: number }[]; width?: number; height?: number; className?: string }) {
  if (points.length < 2) return <span className={`hub-sparkline is-empty ${className}`} style={{ width, height }}>Chart unavailable</span>;
  const prices = points.map(p => p.price), min = Math.min(...prices), max = Math.max(...prices), span = max - min || 1;
  const d = prices.map((p, i) => `${i ? "L" : "M"}${(i / (prices.length - 1)) * width} ${height - 2 - ((p - min) / span) * (height - 4)}`).join(" ");
  const up = prices[prices.length - 1] >= prices[0];
  return <svg className={`hub-sparkline ${up ? "is-up" : "is-down"} ${className}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export function ChangeText({ value, className = "" }: { value: number | null; className?: string }) {
  const tone = value === null ? "" : value > 0 ? " is-up" : value < 0 ? " is-down" : "";
  return <span className={`hub-change${tone} ${className}`}>{value == null ? "Change unavailable" : pct(value)}</span>;
}

/** The move as a pill: tinted by direction, with an arrow that says it twice. */
export function ChangePill({ value, className = "" }: { value: number | null; className?: string }) {
  const tone = value === null ? "" : value > 0 ? " is-up" : value < 0 ? " is-down" : "";
  return <span className={`hub-change hub-pill${tone} ${className}`}>{value == null ? "Change unavailable" : pct(value)}{value != null && value !== 0 && <ArrowUpRight size={11} aria-hidden="true" style={value < 0 ? { transform: "rotate(90deg)" } : undefined} />}</span>;
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

export function AssetCard({ asset: initial, dense = false }: { asset: Asset; dense?: boolean }) {
  const asset = useMarketAsset(initial);
  const { state, signal, send, busy } = useHub();
  const gloss = useGloss();
  const router = useRouter();
  const follow = useFollowRoom();
  const watched = state.profile.interests.some(i => i.id === asset.id || i.symbol?.toUpperCase() === asset.symbol.toUpperCase());
  const important = asset.labelTone === "match";
  function open() { signal("opened", asset); router.push(assetHref(asset)); }
  return (
    <article className={`hub-asset${dense ? " is-dense" : ""}${important ? " hub-priority-card" : ""}`} data-asset={asset.symbol}>
      <button type="button" className="hub-asset-main" onClick={open} aria-label={`Open ${asset.name}`}>
        <span className="hub-asset-id"><strong>{asset.symbol}</strong><span>{asset.name}</span></span>
        <Sparkline points={asset.chart.slice(-40)} />
        <span className="hub-asset-price"><span>{asset.price == null ? "Price unavailable" : usd(asset.price)}</span><ChangeText value={asset.change} /></span>
      </button>
      <div className="hub-asset-foot">
        <button type="button" className="hub-why-trigger" {...gloss(assetGloss(asset, state))}>Why you’re seeing this</button>
        <RelevanceLabel asset={asset} />
        {!dense && asset.reason && <p className="hub-asset-reason">{asset.reason}</p>}
        <div className="hub-asset-actions"><BuyAction asset={asset} />
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

/** Depth on hover: the card tilts a few degrees toward the pointer and settles back when it leaves. */
function useTilt<T extends HTMLElement>(max = 4) {
  const root = useRef<T>(null);
  const { contextSafe } = useGSAP({ scope: root });
  const move = contextSafe((event: React.PointerEvent<T>) => {
    const node = root.current;
    if (!node || event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = node.getBoundingClientRect();
    const nx = (event.clientX - r.left) / r.width - .5, ny = (event.clientY - r.top) / r.height - .5;
    gsap.to(node, { rotateY: nx * max * 2, rotateX: -ny * max * 2, transformPerspective: 900, duration: .5, ease: "power3.out", overwrite: "auto" });
    node.style.setProperty("--mx", `${(nx + .5) * 100}%`); node.style.setProperty("--my", `${(ny + .5) * 100}%`);
  });
  const leave = contextSafe(() => { if (root.current) gsap.to(root.current, { rotateY: 0, rotateX: 0, duration: .7, ease: rubiconMotion.ease.enter, overwrite: "auto" }); });
  return { root, onPointerMove: move, onPointerLeave: leave };
}

function DiscoveryCard({ asset: initial }: { asset: Asset }) {
  const asset = useMarketAsset(initial);
  const { state, signal, send, busy } = useHub();
  const router = useRouter();
  const follow = useFollowRoom();
  const tilt = useTilt<HTMLElement>();
  const [pending, setPending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const watched = state.profile.interests.some(i => i.id === asset.id || i.symbol?.toUpperCase() === asset.symbol.toUpperCase());
  async function act(action: "watched" | "removed" | "dismissed") {
    setPending(true); const saved = await signal(action, asset); if (saved && action === "dismissed") setDismissed(true); setPending(false);
  }
  if (dismissed) return null;
  return <article ref={tilt.root} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave} className={`hub-discovery-card${asset.labelTone === "match" ? " hub-priority-card" : ""}`} data-asset={asset.symbol}>
    <Link className="hub-discovery-main" href={assetHref(asset)} onClick={() => { void signal("opened", asset); }} aria-label={`Open ${asset.name}`}>
      <AssetLogo asset={asset} />
      <span className="hub-discovery-price"><strong>{asset.price == null ? "Price unavailable" : usd(asset.price)}</strong><small>{asset.kind === "crypto" ? "Crypto" : "Stock"}</small></span>
      <span className="hub-discovery-name"><strong>{asset.name}</strong><small>{asset.symbol} <ChangeText value={asset.change} /></small></span>
      <Sparkline points={asset.chart.slice(-40)} width={160} height={40} />
      {asset.description && <p className="hub-discovery-description">{asset.description}</p>}
    </Link>
    <div className="hub-discovery-actions"><BuyAction asset={asset} />
      <button type="button" className="hub-chip-button" disabled={pending || busy || (!watched && !follow.room)} data-tooltip={follow.title} aria-pressed={watched} onClick={() => void act(watched ? "removed" : "watched")}>{watched ? <Check size={14} /> : <Eye size={14} />}{watched ? "Watching" : "Watch"}</button>
      <button type="button" className="hub-chip-button" disabled={busy || pending} onClick={() => { router.push("/"); void send(`Tell me about ${asset.name} (${asset.symbol}) and why it might interest me.`); }}>Ask agent</button>
      <button type="button" className="hub-discovery-dismiss" disabled={pending || busy} data-tooltip="Not for me" aria-label={`Not interested in ${asset.symbol}`} onClick={() => void act("dismissed")}><X size={15} /></button>
    </div>
  </article>;
}

/** A quiet, tactile opening. Further actions live on the asset page.
 *
 * The card is a small instrument: what it is, what it costs, how it moved, and
 * the trace of how it got here running off the bottom edge. Reaching across
 * the trace reads a point off it; the rest of the card stays exactly as it was. */
function QuietAssetCard({ asset: initial }: { asset: Asset }) {
  const asset = useMarketAsset(initial);
  const { signal } = useHub();
  const tilt = useTilt<HTMLElement>(2);
  const [hit, setHit] = useState<TraceHit | null>(null);
  const points = asset.chart.slice(-40);
  const read = hit ? points[hit.index] : null;
  return <article ref={tilt.root} className={`hub-quiet-card${hit ? " is-reading" : ""}`} data-asset={asset.symbol} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
    <Link href={assetHref(asset)} onClick={() => { void signal("opened", asset); }} aria-label={`Open ${asset.name}`}>
      <span className="quiet-card-top">
        <span className="quiet-card-title"><AssetLogo asset={asset}/><span><strong>{asset.symbol}</strong><small>{asset.name}</small></span></span>
        <span className="quiet-card-open" aria-hidden="true"><ArrowUpRight size={14}/></span>
      </span>
      <span className="quiet-card-quote">
        <strong className="quiet-card-price">{asset.price == null ? "Price unavailable" : usd(asset.price)}</strong>
        <span className="quiet-card-delta"><small>today</small><ChangePill value={asset.change}/></span>
      </span>
      <span className="quiet-card-chart">
        {points.length > 1 ? <PriceTrace points={points} height={92} pad={{ top: 30, bottom: 0 }} onScrub={setHit} /> : <small>Price history unavailable</small>}
        {read && hit && <span className={`trace-chip${hit.y < 52 ? " is-below" : ""}`} style={{ left: Math.min(Math.max(hit.x, 64), hit.width - 64), top: hit.y < 52 ? hit.y + 14 : hit.y - 12 }}><small>{traceDate(read.time)}</small><b>{usd(read.price)}</b></span>}
        <span className="quiet-card-signal">{asset.label || "A new connection"}</span>
      </span>
    </Link>
  </article>;
}

/** Buy, or the honest reason you can't.
 *
 * Every Buy affordance in the app resolves through `tradability`, so a card can
 * never offer a purchase the execution path would refuse. An asset with no Base
 * market keeps its place on the screen — following it is still worth something —
 * and says what is missing instead of failing after the tap. */
export function BuyAction({ asset, amount, className = "hub-buy-primary" }: { asset: Asset; amount?: string; className?: string }) {
  const verdict = tradability({ symbol: asset.symbol, name: asset.name, kind: asset.kind, contracts: asset.contracts });
  if (verdict.status === "tradable") return <button type="button" className={className} onClick={() => openPurchase({ asset, ...(amount ? { amount } : {}) })}>Buy</button>;
  return <button type="button" className={`${className} is-unavailable`} disabled aria-disabled="true" title={verdict.detail} data-tooltip={verdict.detail}>{verdict.reason}</button>;
}

export function AssetGrid({ assets, title, dense, discovery = false, quiet = false }: { assets: Asset[]; title?: string; dense?: boolean; discovery?: boolean; quiet?: boolean }) {
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
    <div className={discovery ? "hub-discovery-grid" : "hub-asset-grid"}>{visible.map(asset => quiet ? <QuietAssetCard key={`${asset.kind}:${asset.id}`} asset={asset} /> : discovery ? <DiscoveryCard key={`${asset.kind}:${asset.id}`} asset={asset} /> : <AssetCard key={`${asset.kind}:${asset.id}`} asset={asset} dense={dense} />)}</div>{discovery && !visible.length && <p className="hub-empty" role="status">All caught up. Try another category to discover more.</p>}
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

export function TradeCard({ tradeId, expanded = false }: { tradeId: string; expanded?: boolean }) {
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
  if (trade.crypto?.bridge) return <BridgeTradeCard trade={trade} />;
  if (trade.crypto) return <CryptoTradeCard trade={trade} expanded={expanded} />;
  const pending = trade.status === "approval_required";
  const connected = state.brokerage?.connected ?? false;
  return <div ref={root} className={`hub-trade is-${trade.status}${pending ? " hub-priority-card" : ""}`} role="group" aria-label="Trade confirmation">
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
    case "assets": return <AssetGrid assets={part.assets} title={part.title} quiet />;
    case "asset": return <AssetGrid assets={[part.asset]} quiet />;
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
