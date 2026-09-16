"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import type { TradeIntent } from "@/lib/socialtrading/types";
import { usd } from "./format";

const OMITTED = new Set<TradeIntent["status"]>(["blocked", "rejected", "failed"]);
const COMPLETE = new Set<TradeIntent["status"]>(["submitted", "confirmed"]);
const statusLabel: Record<TradeIntent["status"], string> = {
  blocked: "Blocked", approval_required: "Awaiting approval", reserved: "Quote ready",
  submitted: "Submitted", confirmed: "Completed", rejected: "Rejected", failed: "Failed", unknown: "Status pending",
};

type Point = TradeIntent & { x: number; y: number; total: number };

function series(trades: TradeIntent[], width: number, height: number) {
  const ordered = trades.filter(trade => !OMITTED.has(trade.status)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let total = 0;
  const totals = ordered.map(trade => (total += trade.side === "buy" ? trade.value : -trade.value));
  const low = Math.min(0, ...totals), high = Math.max(0, ...totals), range = Math.max(high - low, 1);
  const left = 36, right = 26, top = 54, bottom = 34;
  const x = (i: number) => left + (ordered.length === 1 ? (width - left - right) / 2 : i * (width - left - right) / (ordered.length - 1));
  const y = (value: number) => top + (high - value) * (height - top - bottom) / range;
  return {
    points: ordered.map((trade, i): Point => ({ ...trade, total: totals[i], x: x(i), y: y(totals[i]) })),
    zeroY: y(0), high, low,
  };
}

const date = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(iso));

/** A deliberately small chart of the orders already in hub state. Every point
 * remains individually named instead of being folded into an anonymous total. */
export function TradeActivityChart({ trades }: { trades: TradeIntent[] }) {
  const shown = trades.filter(trade => !OMITTED.has(trade.status));
  if (!shown.length) return null;
  const buys = shown.filter(t => t.side === "buy").reduce((sum, t) => sum + t.value, 0);
  const sells = shown.filter(t => t.side === "sell").reduce((sum, t) => sum + t.value, 0);
  const net = buys - sells;
  const width = Math.max(680, shown.length * 112);
  const height = 230;
  const { points, zeroY, high, low } = series(shown, width, height);
  const path = [`M 36 ${zeroY}`, ...points.map(p => `L ${p.x} ${p.y}`)].join(" ");

  return <section className="hub-trade-chart" aria-labelledby="hub-trade-chart-title">
    <div className="hub-trade-chart-head">
      <div>
        <p className="hub-part-title" id="hub-trade-chart-title">Trade activity</p>
        <strong>{usd(net, 0)}</strong>
        <span>net order value</span>
      </div>
      <div className="hub-trade-chart-stats" aria-label="Order totals">
        <span className="is-buy"><TrendingUp size={13} aria-hidden="true" />{usd(buys, 0)} buys</span>
        <span className="is-sell"><TrendingDown size={13} aria-hidden="true" />{usd(sells, 0)} sells</span>
      </div>
    </div>
    <div className="hub-trade-chart-scroll">
      <svg className="hub-trade-chart-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative order value with one labeled point for every stock and crypto order">
        <line className="hub-trade-chart-grid" x1="36" x2={width - 26} y1={zeroY} y2={zeroY} />
        {high > 0 && <text className="hub-trade-chart-axis" x="4" y="58">{usd(high, 0)}</text>}
        {low < 0 && <text className="hub-trade-chart-axis" x="4" y={height - 36}>{usd(low, 0)}</text>}
        <path className="hub-trade-chart-line" d={path} />
        {points.map((point, i) => {
          const labelY = Math.max(23, point.y - (i % 2 ? 40 : 27));
          const boxWidth = Math.max(52, point.asset.symbol.length * 8 + 26);
          const boxX = Math.min(width - boxWidth - 5, Math.max(5, point.x - boxWidth / 2));
          return <g key={point.id} className={`hub-trade-chart-point is-${point.side}${COMPLETE.has(point.status) ? " is-complete" : " is-pending"}`}>
            <line x1={point.x} x2={point.x} y1={point.y - 3} y2={labelY + 16} />
            <rect x={boxX} y={labelY} width={boxWidth} height="24" rx="12" />
            <text x={boxX + boxWidth / 2} y={labelY + 15}>{point.asset.symbol}</text>
            <circle cx={point.x} cy={point.y} r="5" />
            <title>{`${point.side === "buy" ? "Buy" : "Sell"} ${usd(point.value, 0)} of ${point.asset.name} (${point.asset.kind}) · ${statusLabel[point.status]} · ${date(point.createdAt)}`}</title>
          </g>;
        })}
        <text className="hub-trade-chart-date" x="36" y={height - 8}>{date(points[0].createdAt)}</text>
        {points.length > 1 && <text className="hub-trade-chart-date" textAnchor="end" x={width - 26} y={height - 8}>{date(points.at(-1)!.createdAt)}</text>}
      </svg>
    </div>
    <ul className="hub-trade-chart-list" aria-label="Orders shown on chart">
      {points.map(point => <li key={point.id}><strong>{point.asset.symbol}</strong><span>{point.asset.kind}</span><span>{point.side === "buy" ? "Buy" : "Sell"} {usd(point.value, 0)}</span><span>{statusLabel[point.status]}</span></li>)}
    </ul>
  </section>;
}
