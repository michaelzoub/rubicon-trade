"use client";

import { ArrowLeftRight, BadgeCheck, Bot, Orbit, Sparkles } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ActivityEvent, TradeIntent } from "@/lib/socialtrading/types";
import { gsap, useGSAP, ScrollTrigger, rubiconMotion } from "../../_components/motion";
import { chain, explorerTx, shortAddress } from "@/lib/crypto/chains";
import { cryptoStatus } from "./crypto-trade-card";
import { clock, dayLabel, usd } from "./format";
import { useHub } from "./hub-provider";
import { Lens } from "./lens";
import { HubLink as Link } from "./navigation";
import { TradeActivityChart } from "./trade-activity-chart";

type Item = { id: string; at: string; kind: ActivityEvent["kind"]; text: string; detail?: string; trade?: TradeIntent };
const FILTERS = [
  { id: "all", label: "Everything", icon: Orbit, hue: "#2f80ed" },
  { id: "learning", label: "Learning", icon: Sparkles, hue: "#7c6bd6" },
  { id: "profile", label: "Updates", icon: BadgeCheck, hue: "#2fa38a" },
  { id: "trade", label: "Trades", icon: ArrowLeftRight, hue: "#d98a3a" },
] as const;
type Filter = typeof FILTERS[number]["id"];
const KIND_LABEL: Record<Item["kind"], string> = { learning: "Learned", profile: "Profile", agent: "Agent", trade: "Trade" };
const KIND_ICON = { learning: Sparkles, profile: BadgeCheck, agent: Bot, trade: ArrowLeftRight } as const;

/** A trade that cannot move until the person acts. */
export const needsYou = (trade?: TradeIntent) => !!trade && (trade.status === "approval_required" || (!!trade.crypto && trade.status === "reserved" && trade.crypto.phase === "ready"));

export function ActivityView() {
  const { state } = useHub();
  const [filter, setFilter] = useState<Filter>("all");
  const root = useRef<HTMLDivElement>(null);
  const all = useMemo<Item[]>(() => {
    const events: Item[] = state.events.map(e => ({ ...e, trade: e.tradeId ? state.trades.find(t => t.id === e.tradeId) : undefined }));
    const covered = new Set(state.events.map(e => e.tradeId).filter(Boolean));
    const trades: Item[] = state.trades.filter(t => !covered.has(t.id)).map(t => ({ id: `trade:${t.id}`, at: t.createdAt, kind: "trade", text: `${t.side === "buy" ? "Buy" : "Sell"} ${t.asset.symbol} for ${usd(t.value, 2)}`, detail: t.policy.reason, trade: t }));
    return [...events, ...trades].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [state.events, state.trades]);
  const items = useMemo(() => all.filter(i => filter === "all" || i.kind === filter || (filter === "profile" && i.kind === "agent")), [all, filter]);
  const days = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of items) { const key = dayLabel(item.at); groups.set(key, [...(groups.get(key) ?? []), item]); }
    return [...groups.entries()];
  }, [items]);

  /** The week in words: what the agent learned, what changed, what waits. */
  const pulse = useMemo(() => {
    const week = Date.now() - 7 * 86400_000;
    const recent = all.filter(i => Date.parse(i.at) >= week);
    return {
      learned: recent.filter(i => i.kind === "learning").length,
      updates: recent.filter(i => i.kind === "profile" || i.kind === "agent").length,
      waiting: new Set(all.filter(i => needsYou(i.trade)).map(i => i.trade!.id)).size,
    };
  }, [all]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const rows = gsap.utils.toArray<HTMLElement>("[data-timeline-item]", root.current);
      gsap.set(rows, { opacity: 0, y: 14 });
      ScrollTrigger.batch(rows, { start: "top 92%", once: true, onEnter: batch => gsap.to(batch, { opacity: 1, y: 0, duration: .5, stagger: .06, ease: rubiconMotion.ease.enter, clearProps: "all", overwrite: true }) });
      gsap.fromTo("[data-pulse]", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .5, stagger: .08, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [filter, items.length], revertOnUpdate: true });

  return (
    <div className="hub-activity" ref={root}>
      <header className="hub-view-head">
        <p className="eyebrow">Activity</p>
        <h1 className="landing-section-title">Your world, lately.</h1>
        <p>What your agent learned, what changed, and what it did for you.</p>
      </header>
      <div className="hub-pulse" aria-label="This week">
        <span className="hub-pulse-bead is-learning" data-pulse><Sparkles size={13} aria-hidden="true" />{pulse.learned === 0 ? "Nothing new learned" : `${pulse.learned} ${pulse.learned === 1 ? "thing" : "things"} learned`}<small>this week</small></span>
        <span className="hub-pulse-bead is-profile" data-pulse><BadgeCheck size={13} aria-hidden="true" />{pulse.updates === 0 ? "No profile changes" : `${pulse.updates} ${pulse.updates === 1 ? "update" : "updates"}`}<small>this week</small></span>
        <span className={`hub-pulse-bead is-trade${pulse.waiting ? " is-live" : ""}`} data-pulse><ArrowLeftRight size={13} aria-hidden="true" />{pulse.waiting === 0 ? "Nothing waiting on you" : `${pulse.waiting} ${pulse.waiting === 1 ? "trade" : "trades"} waiting for you`}{pulse.waiting > 0 && <Link href="/" className="hub-pulse-link">Review</Link>}</span>
      </div>
      <Lens items={FILTERS} value={filter} onChange={setFilter} label="Kinds of activity" className="hub-activity-lens" />
      {(filter === "all" || filter === "trade") && <TradeActivityChart trades={state.trades} />}
      {days.length === 0 && <div className="hub-empty"><p>Nothing here yet. Open a few opportunities or talk to your agent and this fills in.</p></div>}
      {days.map(([day, list]) => <section key={day} className="hub-day">
        <h2 className="hub-day-label"><span>{day}</span></h2>
        <ol className="hub-timeline">
          {list.map(item => {
            const Icon = KIND_ICON[item.kind]; const urgent = needsYou(item.trade);
            return <li key={item.id} data-timeline-item className={`hub-event is-${item.kind}${urgent ? " is-urgent hub-priority-card" : ""}`}>
              <span className="hub-event-medallion" aria-hidden="true"><Icon size={14} strokeWidth={1.8} /></span>
              <div className="hub-event-body">
                <p className="hub-event-meta"><span>{KIND_LABEL[item.kind]}</span>{urgent && <span className="hub-event-flag">Needs you</span>}<time dateTime={item.at}>{clock(item.at)}</time></p>
                {item.trade ? <div className="hub-event-trade">
                  <p className="hub-event-text"><strong>{item.text}</strong></p>
                  <p className="hub-event-detail">{item.trade.crypto ? cryptoStatus(item.trade) : item.trade.status.replace("_", " ")} · {item.trade.initiator === "user" ? "placed by you" : "proposed by your agent"}</p>
                  {item.trade.reasoning && <p className="hub-event-detail">{item.trade.reasoning}</p>}
                  <details className="hub-activity-details"><summary>Details</summary><dl>
                    <div><dt>Value</dt><dd>{usd(item.trade.value, 2)}</dd></div>
                    <div><dt>Status</dt><dd>{item.trade.crypto ? cryptoStatus(item.trade) : item.trade.status.replace("_", " ")}</dd></div>
                    <div><dt>Placed by</dt><dd>{item.trade.initiator === "user" ? "You" : "Your agent"}</dd></div>
                    {item.trade.approval && <div><dt>You</dt><dd>{item.trade.approval.decision}</dd></div>}
                    {item.trade.brokerage && <div><dt>Robinhood</dt><dd>{item.trade.brokerage.status.replace("_", " ")}</dd></div>}
                    {item.trade.crypto && <div><dt>Network</dt><dd>{chain(item.trade.crypto.request.chainId).name} · Uniswap</dd></div>}
                    {item.trade.crypto?.hash && <div><dt>Transaction</dt><dd className="mono" style={{ textTransform: "none" }}><a href={explorerTx(item.trade.crypto.request.chainId, item.trade.crypto.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(item.trade.crypto.hash)}</a></dd></div>}
                  </dl></details>
                  {urgent && <Link href="/" className="hub-chip-button hub-event-review">Review in conversation</Link>}
                </div> : <><p className="hub-event-text">{item.text}</p>{item.detail && <p className="hub-event-detail">{item.detail}</p>}</>}
              </div>
            </li>;
          })}
        </ol>
      </section>)}
    </div>
  );
}
