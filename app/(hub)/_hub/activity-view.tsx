"use client";

import { useMemo, useRef, useState } from "react";
import type { ActivityEvent, TradeIntent } from "@/lib/socialtrading/types";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { chain, explorerTx, shortAddress } from "@/lib/crypto/chains";
import { cryptoStatus } from "./crypto-trade-card";
import { clock, dayLabel, usd } from "./format";
import { useHub } from "./hub-provider";

type Item = { id: string; at: string; kind: ActivityEvent["kind"]; text: string; detail?: string; trade?: TradeIntent };
const FILTERS = [{ id: "all", label: "Everything" }, { id: "learning", label: "Learning" }, { id: "profile", label: "Updates" }, { id: "trade", label: "Trades" }] as const;
const KIND_LABEL: Record<Item["kind"], string> = { learning: "Learned", profile: "Profile", agent: "Agent", trade: "Trade" };

export function ActivityView() {
  const { state } = useHub();
  const [filter, setFilter] = useState<typeof FILTERS[number]["id"]>("all");
  const root = useRef<HTMLDivElement>(null);
  const items = useMemo<Item[]>(() => {
    const events: Item[] = state.events.map(e => ({ ...e, trade: e.tradeId ? state.trades.find(t => t.id === e.tradeId) : undefined }));
    const covered = new Set(state.events.map(e => e.tradeId).filter(Boolean));
    const trades: Item[] = state.trades.filter(t => !covered.has(t.id)).map(t => ({ id: `trade:${t.id}`, at: t.createdAt, kind: "trade", text: `${t.side === "buy" ? "Buy" : "Sell"} ${t.asset.symbol} for ${usd(t.value, 2)}`, detail: t.policy.reason, trade: t }));
    return [...events, ...trades].filter(i => filter === "all" || i.kind === filter || (filter === "profile" && i.kind === "agent")).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [state.events, state.trades, filter]);
  const days = useMemo(() => {
    const groups = new Map<string, Item[]>();
    for (const item of items) { const key = dayLabel(item.at); groups.set(key, [...(groups.get(key) ?? []), item]); }
    return [...groups.entries()];
  }, [items]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-timeline-item]", { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: .34, stagger: { each: .03, from: "start" }, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [filter, items.length], revertOnUpdate: true });

  return (
    <div className="hub-activity" ref={root}>
      <header className="hub-view-head">
        <p className="eyebrow">Activity</p>
        <h1 className="landing-section-title">How we got here.</h1>
        <p>Your purchases and updates, all in one place.</p>
      </header>
      <div className="hub-tabs" role="tablist" aria-label="Filter activity">{FILTERS.map(f => <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={`hub-tab${filter === f.id ? " is-active" : ""}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}</div>
      {days.length === 0 && <p className="hub-empty">Nothing here yet. Open a few opportunities or talk to your agent and this fills in.</p>}
      {days.map(([day, list]) => <section key={day} className="hub-day">
        <h2 className="hub-day-label">{day}</h2>
        <ol className="hub-timeline">
          {list.map(item => <li key={item.id} data-timeline-item className={`hub-event is-${item.kind}`}>
            <span className="hub-event-dot" aria-hidden="true" />
            <div className="hub-event-body">
              <p className="hub-event-meta"><span>{KIND_LABEL[item.kind]}</span><time dateTime={item.at}>{clock(item.at)}</time></p>
              {item.trade ? <div className="hub-event-trade">
                <p><strong>{item.text}</strong></p>
                <details className="hub-activity-details"><summary>Details</summary><dl>
                  <div><dt>Value</dt><dd>{usd(item.trade.value, 2)}</dd></div>
                  <div><dt>Status</dt><dd>{item.trade.crypto ? cryptoStatus(item.trade) : item.trade.status.replace("_", " ")}</dd></div>
                  <div><dt>Placed by</dt><dd>{item.trade.initiator === "user" ? "You" : "Your agent"}</dd></div>
                  {item.trade.approval && <div><dt>You</dt><dd>{item.trade.approval.decision}</dd></div>}
                  {item.trade.brokerage && <div><dt>Robinhood</dt><dd>{item.trade.brokerage.status.replace("_", " ")}</dd></div>}
                  {item.trade.crypto && <div><dt>Network</dt><dd>{chain(item.trade.crypto.request.chainId).name} · Uniswap</dd></div>}
                  {item.trade.crypto?.hash && <div><dt>Transaction</dt><dd className="mono" style={{ textTransform: "none" }}><a href={explorerTx(item.trade.crypto.request.chainId, item.trade.crypto.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(item.trade.crypto.hash)}</a></dd></div>}
                </dl></details>
                {item.trade.reasoning && <p className="hub-event-detail">{item.trade.reasoning}</p>}
              </div> : <><p className="hub-event-text">{item.text}</p>{item.detail && <p className="hub-event-detail">{item.detail}</p>}</>}
            </div>
          </li>)}
        </ol>
      </section>)}
    </div>
  );
}
