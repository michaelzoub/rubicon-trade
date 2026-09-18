"use client";

import { useMemo, useState } from 'react';
import { ArrowUpRight, Bot, UserRound } from 'lucide-react';
import type { TradeIntent } from '@/lib/socialtrading/types';
import { useHub } from './hub-provider';
import { HubLink } from './navigation';
import { usd } from './format';
import './beliefs.css';

const colors = ['#377ce5', '#81b5ed', '#abcbd8', '#9a9cdb', '#c2ae91', '#b7c8ee'];
const date = (at: string) => new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export function beliefSeries(trades: TradeIntent[]) {
  const orders = trades.filter(t => t.status === 'confirmed').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const keys = [...new Set(orders.map(t => `${t.asset.kind}:${t.asset.id}`))];
  const balances = new Map<string, number>();
  const points = orders.map(trade => {
    const key = `${trade.asset.kind}:${trade.asset.id}`;
    balances.set(key, Math.max(0, (balances.get(key) ?? 0) + (trade.side === 'buy' ? trade.value : -trade.value)));
    return { trade, values: keys.map(k => balances.get(k) ?? 0) };
  });
  return { keys, points };
}

export function BeliefsGraph() {
  const { state } = useHub();
  const { keys, points } = useMemo(() => beliefSeries(state.trades), [state.trades]);
  const [selected, select] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const last = points.at(-1);
  const current = points.find(p => p.trade.id === selected)?.trade ?? [...points].reverse().find(p => (!filter || `${p.trade.asset.kind}:${p.trade.asset.id}` === filter))?.trade;
  const peak = Math.max(1, ...points.map(p => p.values.reduce((a,b) => a+b, 0)));
  const x = (i: number) => 44 + (i + 1) * 912 / Math.max(points.length, 1);
  const y = (value: number) => 300 - value / peak * 190;
  const upper = (i: number, layer: number) => points[i].values.slice(0, layer + 1).reduce((a,b) => a+b, 0);
  const visible = (trade: TradeIntent) => (!filter || `${trade.asset.kind}:${trade.asset.id}` === filter);
  return <section className="belief-map" aria-labelledby="belief-map-title">
    <header className="belief-map-head"><div><p className="eyebrow" id="belief-map-title">Investment history</p><h2>{usd(last?.values.reduce((a,b) => a+b, 0) ?? 0, 0)}</h2><p>Recorded net investment <span>· {keys.length} assets</span></p></div></header>
    {points.length ? <><div className="belief-plot"><svg viewBox="0 0 1000 350" role="img" aria-label="Recorded investments layered by asset over completed buy and sell decisions"><defs>{colors.map((color, i) => <linearGradient key={color} id={`belief-fill-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".6"/><stop offset="1" stopColor={color} stopOpacity=".16"/></linearGradient>)}</defs>{[0, .5, 1].map(v => <line key={v} x1="44" x2="956" y1={y(peak*v)} y2={y(peak*v)} stroke="#eaf0f7" strokeDasharray="3 7"/>)}{keys.map((key, layer) => { const top = points.map((_, i) => `L ${x(i)} ${y(upper(i, layer))}`).join(' '); const bottom = [...points].reverse().map((_, reversed) => { const i = points.length-1-reversed; return `L ${x(i)} ${y(layer ? upper(i, layer-1) : 0)}`; }).join(' '); return <path key={key} d={`M 44 300 ${top} ${bottom} Z`} fill={`url(#belief-fill-${layer % colors.length})`} stroke={colors[layer % colors.length]} strokeWidth="1.5" opacity={filter && filter !== key ? .18 : 1}/>; })}{points.map((p,i) => <line key={p.trade.id} x1={x(i)} x2={x(i)} y1="78" y2={y(p.values.reduce((a,b) => a+b,0))} stroke="#c8d9ec" opacity={visible(p.trade) ? .7 : .12}/>)}<text x="44" y="335" fill="#8c99ab" fontSize="11">{date(points[0].trade.createdAt)}</text><text x="956" y="335" textAnchor="end" fill="#8c99ab" fontSize="11">{date(last!.trade.createdAt)}</text></svg><div className="belief-markers">{points.map((p,i) => <button key={p.trade.id} style={{ left: `${x(i)/10}%`, top: `${i%2 ? 17 : 6}%` }} className={`${current?.id === p.trade.id ? 'is-selected' : ''} ${visible(p.trade) ? '' : 'is-muted'}`} aria-label={`${p.trade.initiator === 'user' ? 'You' : 'Your agent'}: ${p.trade.side} ${p.trade.asset.symbol}, ${date(p.trade.createdAt)}`} aria-pressed={current?.id === p.trade.id} onClick={() => { select(p.trade.id); setFilter(null); }}>{p.trade.initiator === 'user' ? <UserRound size={14}/> : <Bot size={14}/>}<span>{p.trade.asset.symbol}</span></button>)}</div></div><div className="belief-legend"><button aria-pressed={!filter} onClick={() => setFilter(null)}>All holdings</button>{keys.map((key,i) => <button key={key} aria-pressed={filter === key} onClick={() => { setFilter(filter === key ? null : key); select(null); }}><i style={{ background: colors[i%colors.length] }}/>{points.find(p => `${p.trade.asset.kind}:${p.trade.asset.id}` === key)!.trade.asset.symbol}</button>)}</div>{current ? <article className="belief-decision"><div className="belief-decision-origin">{current.initiator === 'user' ? <UserRound size={18}/> : <Bot size={18}/>}<span>{current.initiator === 'user' ? 'Your decision' : 'Agent initiated'}<small>{date(current.createdAt)}</small></span></div><div><p className="eyebrow">{current.side === 'buy' ? 'Why it was bought' : 'Why it was sold'}</p><h3>{current.asset.name} <span>· {usd(current.value, 0)}</span></h3><p>{current.reasoning || 'No reason was recorded for this decision.'}</p></div><HubLink href={`/explore/${current.asset.kind}/${encodeURIComponent(current.asset.id)}`} aria-label={`Explore ${current.asset.name}`}><ArrowUpRight size={20}/></HubLink></article> : <p className="belief-no-decisions">No decisions match this origin. Choose another filter.</p>}<p className="belief-footnote">Completed buy and sell amounts · not live portfolio value.</p></> : <div className="belief-empty"><span className="wv-mini-orb"/><h3>Your story starts here.</h3><p>Completed purchases and their reasons will appear here.</p><HubLink href="/explore">Explore your next idea <ArrowUpRight size={14}/></HubLink></div>}
  </section>;
}
