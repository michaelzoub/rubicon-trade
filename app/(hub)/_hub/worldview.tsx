"use client";
import { useRef, useState, type CSSProperties } from 'react';
import { ArrowUpRight, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { convictionsOf, relevance } from '@/lib/socialtrading/worldview';
import { THEMES } from '@/lib/socialtrading/themes';
import type { Asset } from '@/lib/socialtrading/types';
import { gsap, useGSAP } from '../../_components/motion';
import { ProfileAvatar } from '../profile-avatar';
import { useHub } from './hub-provider';
import { HubLink } from './navigation';
import { AssetLogo, Sparkline, ChangeText } from './parts';
import { usd } from './format';
import { openPurchase } from './purchase';
import './worldview.css';

function useAssembly(key: unknown) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.fromTo(root.current?.querySelectorAll('[data-assemble]') ?? [], { opacity: 0, y: 14, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .7, stagger: .07, clearProps: 'all' }); });
    return () => media.revert();
  }, { scope: root, dependencies: [key], revertOnUpdate: true });
  return root;
}
export function ThesisView({ compact = false }: { compact?: boolean }) {
  const { state, mutate, busy } = useHub();
  const beliefs = convictionsOf(state);
  const [selected, select] = useState<string | null>(null);
  const [editing, edit] = useState(false);
  const [text, setText] = useState('');
  const current = beliefs.find(c => c.id === selected);
  const root = useAssembly(selected);
  async function save(strength: number, remove = false) {
    const result = await mutate({ action: 'conviction', id: current?.id ?? crypto.randomUUID(), text: editing ? text : current?.text ?? text, strength, remove });
    if (result) { select(null); edit(false); setText(''); }
  }
  return <section className={`wv-thesis ${compact ? 'is-compact' : ''}`}>
    <header className="wv-heading"><div><p className="eyebrow">Thesis · a living object</p><h1 className="landing-section-title">What you believe.</h1><p>A point of view. Always becoming.</p></div>{compact ? <HubLink href="/thesis" className="hub-inline-link">Open your thesis <ArrowUpRight size={14}/></HubLink> : <button className="hub-chip-button" onClick={() => { select(null); edit(true); setText(''); }}><Plus size={14}/> Add a belief</button>}</header>
    <div className="wv-thesis-layout" ref={root}>
      <div className="wv-strata" aria-label="Your convictions">
        <span className="wv-axis">YOUR WORLDVIEW</span>
        {beliefs.length === 0 && <p className="hub-empty">Start with one thing you believe about the future.</p>}
        {beliefs.slice(0, compact ? 3 : 30).map((c, i) => <button key={c.id} className={`wv-stratum ${selected === c.id ? 'is-selected' : ''}`} style={{ '--weight': c.strength, '--offset': `${i % 3 * 14}px` } as CSSProperties} onClick={() => { select(c.id); edit(false); }} aria-pressed={selected === c.id}><span className="wv-number">{String(i + 1).padStart(2, '0')}</span><strong>{c.text}</strong><small>{c.strength >= .7 ? 'Core conviction' : c.strength >= .4 ? 'Taking shape' : 'An open question'}</small><ArrowUpRight size={16}/></button>)}
        <div className="wv-strata-foot"><span className="wv-blue-dot"/> Beliefs carry weight. Uncertainty leaves room.</div>
      </div>
      {!compact && <aside className="wv-inspect" data-assemble>
        {current || editing ? <><p className="eyebrow">{editing ? 'In your own words' : 'Inside this conviction'}</p>{editing ? <textarea aria-label="Belief" value={text} onChange={e => setText(e.target.value)} maxLength={1000} autoFocus placeholder="I believe…"/> : <h2>{current?.text}</h2>}
          {current && <><p>{current.origin}</p><small>Last considered {new Date(current.updatedAt).toLocaleDateString()}</small><div className="wv-context"><span>Connected through</span><p>{current.themes.length ? current.themes.join(' · ') : 'Your broader worldview'}</p><span>Still uncertain</span><p>{current.strength < .7 ? 'This idea needs more evidence before it becomes a core conviction.' : 'Conviction reflects your belief, not a verified market forecast.'}</p></div></>}
          <div className="wv-actions">{editing ? <><button disabled={busy || !text.trim()} onClick={() => void save(current?.strength ?? .5)}>Keep this belief</button><button onClick={() => edit(false)}>Cancel</button></> : <><button disabled={busy || current!.strength >= 1} onClick={() => void save(Math.min(1, current!.strength + .15))}>Strengthen</button><button disabled={busy || current!.strength <= 0} onClick={() => void save(Math.max(0, current!.strength - .15))}>Soften</button><button onClick={() => { setText(current!.text); edit(true); }}>Correct the agent</button><button disabled={busy} onClick={() => void save(0, true)}>Let this go</button></>}</div></> : <><span className="wv-mini-orb"/><h2>Your thinking has a shape.</h2><p>Select a layer to trace its origin, question an assumption, or change how much weight it carries.</p><HubLink className="hub-inline-link" href="/activity">Revisit how you got here <ArrowUpRight size={14}/></HubLink></>}
      </aside>}
    </div>
  </section>;
}
export function DecisionSurface({ asset: providedAsset, question, onClose }: { asset?: Asset; question?: string; onClose: () => void }) {
  const { state, signal, send, busy, messages } = useHub();
  const [feedback, setFeedback] = useState('');
  const [investigation, setInvestigation] = useState<string>();
  const askedAt = messages.findLastIndex(m => m.role === 'user' && m.parts.some(p => p.type === 'text' && p.text === (investigation ?? question)));
  const response = askedAt >= 0 ? messages.slice(askedAt + 1).find(m => m.role === 'assistant') : undefined;
  const asset = providedAsset ?? response?.parts.flatMap(p => p.type === 'asset' ? [p.asset] : p.type === 'assets' ? p.assets : [])[0];
  const reasons = response?.parts.flatMap(p => p.type === 'explanation' ? p.reasons : []) ?? [];
  const root = useAssembly(asset?.id ?? question);
  const belief = convictionsOf(state).filter(c => !asset || c.themes.some(t => asset.themes.includes(t))).sort((a,b) => b.strength-a.strength)[0];
  const history = state.signals.filter(s => asset && (s.target === asset.id || s.target === asset.symbol)).slice(-3);
  return <div className="wv-decision" ref={root} aria-label="Decision workspace" aria-live="polite">
    <header data-assemble><span className="wv-mini-orb"/><p className="eyebrow">Your agent · putting this in perspective</p><button className="wv-close" onClick={onClose} aria-label="Close decision workspace"><X size={17}/></button></header>
    <h2 data-assemble>{question ?? `Where ${asset?.name} fits in your world.`}</h2>
    <div className="wv-reasoning">
      <section data-assemble><span>01 / YOUR BELIEF</span><h3>{belief?.text ?? 'No direct thesis connection yet.'}</h3><p>{belief?.origin ?? 'Treat this as a discovery, rather than an established fit.'}</p></section>
      <section data-assemble><span>02 / THE SIGNAL</span>{asset ? <><h3>{asset.news[0]?.title ?? asset.label ?? asset.name}</h3><p>{asset.reason ?? asset.description ?? 'The available market data does not yet explain the move.'}</p>{asset.news[0] && <a href={asset.news[0].url} target="_blank" rel="noreferrer">Read source ↗</a>}<small>{asset.source} · {asset.asOf ? new Date(asset.asOf).toLocaleString() : 'Timestamp unavailable'}</small></> : <p>{busy ? 'Your agent is gathering evidence…' : response?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') || 'Ask your agent to gather evidence for this question.'}</p>}</section>
      <section data-assemble><span>03 / WHY IT MATTERS</span><h3>{belief ? 'Test the belief behind the interest.' : 'Find the connection first.'}</h3><p>{reasons.join(' ') || asset?.reason || 'Separate a change in the underlying business from a change in its market price.'}</p><span>WHAT REMAINS OPEN</span><p>A price move alone cannot confirm or disprove your thesis. The cause, duration, and effect on your assumptions still need checking.</p></section>
    </div>
    <footer data-assemble><div><span className="eyebrow">Your memory</span><p>{history.length ? history.map(s => `${s.action} · ${new Date(s.at).toLocaleDateString()}`).join(' / ') : 'No recorded decision on this idea yet.'}</p></div><div className="wv-actions">{asset && <><button onClick={() => openPurchase({ asset })}>Buy {asset.symbol}</button><button disabled={busy} onClick={async () => { if (await signal('watched', asset)) setFeedback('Kept in your world.'); }}>Keep watching</button><button disabled={busy} onClick={async () => { if (await signal('dismissed', asset)) { setFeedback('Moved to the periphery.'); } }}>Not for me</button></>}<button disabled={busy} onClick={() => { const prompt = `Investigate the evidence, thesis connection, uncertainty and possible actions for: ${question ?? asset?.name}`; setInvestigation(prompt); void send(prompt); }}>Investigate with agent</button></div></footer>{investigation && <section className="wv-investigation"><p className="eyebrow">What your agent found</p><p>{busy ? 'Gathering evidence…' : response?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') || 'No evidence returned. Check the workspace error and try again.'}</p></section>}{feedback && <p role="status">{feedback}</p>}
  </div>;
}
/** Stable angular slots preserve spatial memory; only relevance changes the radius. */
export function SpatialMarket({ assets }: { assets: Asset[] }) {
  const { state, userId } = useHub();
  const [selected, select] = useState<Asset>();
  const [hovered, hover] = useState<Asset>();
  const [idea, setIdea] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, number>());
  const beliefs = convictionsOf(state);
  const visible = assets.slice(0, 8);
  const visibleKeys = new Set(visible.map(a => `${a.kind}:${a.id}`));
  for (const key of slots.current.keys()) if (!visibleKeys.has(key)) slots.current.delete(key);
  const ranked = visible.map(asset => {
    const key = `${asset.kind}:${asset.id}`;
    if (!slots.current.has(key)) slots.current.set(key, Array.from({ length: 8 }, (_, i) => i).find(i => ![...slots.current.values()].includes(i))!);
    const fit = relevance(asset, beliefs, state);
    const confidence = Math.max(0, ...state.inferred.filter(i => asset.themes.includes(i.id)).map(i => i.confidence));
    return { asset, fit, confidence, slot: slots.current.get(key)! };
  });
  const inspected = assets.find(a => a.id === selected?.id && a.kind === selected?.kind) ?? selected;
  const preview = hovered;
  const belief = beliefs.find(c => preview?.themes.some(t => c.themes.includes(t)));
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.fromTo('.gravity-asset-head', { opacity: 0 }, { opacity: 1, duration: .55, ease: 'power3.out', clearProps: 'opacity' }); });
    return () => media.revert();
  }, { scope: root, dependencies: [assets.map(a => a.id).join('|')], revertOnUpdate: true });
  return <div className="wv-market" ref={root}>
    <div className="wv-market-caption"><span>YOUR MARKET GRAVITY</span><small>Distance = thesis relevance · depth = agent confidence</small></div>
    <div className="wv-space" aria-label="Market ordered by relevance to your thesis">
      <div className="wv-space-wash"/><div className="gravity-ring gravity-ring--inner"/><div className="gravity-ring gravity-ring--outer"/>
      <div className="gravity-themes">{THEMES.filter(t => beliefs.some(c => c.themes.includes(t.id))).slice(0, 3).map(t => <button key={t.id} onClick={() => { setIdea(t.id); select(undefined); }}>{t.name}<span>↗</span></button>)}</div>
      <HubLink href="/thesis" className="wv-center" aria-label="Open your thesis"><ProfileAvatar profile={state.profile} seed={state.agent?.id ?? userId} themes={state.profile.themes} className="wv-center-orb"/><span>Your thesis</span><small>The center of your world</small></HubLink>
      {ranked.map(({asset, fit, confidence, slot}) => {
        const angle = ([0, 4, 2, 6, 1, 5, 3, 7][slot % 8] * 45 - 22.5) * Math.PI / 180;
        const radius = 30 + (1 - fit) * 11;
        return <button key={`${asset.kind}-${asset.id}`} className={`wv-market-object gravity-asset${fit < .1 ? ' is-rejected' : ''}`} style={{ left: `${50 + Math.cos(angle)*radius}%`, top: `${52 + Math.sin(angle)*radius}%`, '--confidence': confidence } as CSSProperties} aria-pressed={selected?.id === asset.id} aria-label={`${asset.symbol}, ${usd(asset.price)}, ${asset.change ?? 'unavailable'} percent daily change. Inspect thesis connection.`} onPointerEnter={() => hover(asset)} onPointerLeave={() => hover(undefined)} onFocus={() => hover(asset)} onBlur={() => hover(undefined)} onClick={() => { select(asset); setIdea(undefined); }}>
          <span className="gravity-asset-head"><AssetLogo asset={asset}/><span><b>{asset.symbol}</b><span className="gravity-name">{asset.name}</span></span><span className="gravity-confidence" title={confidence ? `${Math.round(confidence*100)}% agent confidence in the connected theme` : 'Agent confidence not established'}/></span>
          <span className="gravity-quote"><strong>{asset.price === null ? 'Unavailable' : usd(asset.price)}</strong><ChangeText value={asset.change}/></span>
          <span className="gravity-signal"><Sparkline points={asset.chart.slice(-30)} width={55} height={16}/><small>{fit < .1 ? 'Set aside' : confidence ? `${Math.round(confidence*100)}% confidence` : 'New connection'}</small></span>
        </button>;
      })}
      {!assets.length && <p className="wv-no-market">Market discoveries will appear here when data is available.</p>}
    </div>
    <div className="gravity-preview" aria-live="polite">{preview ? <><span>YOUR BELIEF</span><p>{belief?.text ?? 'An idea outside your established thesis.'}</p><span>WHAT CHANGED</span><p>{preview.news[0]?.title ?? preview.reason ?? 'No new evidence reported. Select to investigate.'}</p></> : <><span>FOLLOW A CONNECTION</span><p>Hover to see the belief and signal. Select to examine the evidence, uncertainty, and your next move.</p></>}</div>
    <div className="wv-space-footer"><span className="wv-blue-dot"/> Positions change with your thinking. Quotes may be delayed.<HubLink href="/thesis">Adjust your thesis ↗</HubLink></div>
    {idea && <div className="wv-decision"><header><p className="eyebrow">A theme in your world</p><button className="wv-close" aria-label="Close theme" onClick={() => setIdea(undefined)}><X size={17}/></button></header><h2>{THEMES.find(t => t.id === idea)?.name}</h2><div className="wv-reasoning">{beliefs.filter(c => c.themes.includes(idea)).map(c => <section key={c.id}><span>CONNECTED BELIEF</span><h3>{c.text}</h3><p>{c.origin}</p><HubLink href="/thesis">Reconsider this belief ↗</HubLink></section>)}</div></div>}
    {inspected && <DecisionSurface asset={inspected} onClose={() => select(undefined)}/>}
  </div>;
}
export function MemoryView() {
  const { state } = useHub();
  const [index, setIndex] = useState<number | null>(null);
  const memories = state.worldview?.memories ?? [];
  const frames = memories.length ? memories : [{ id: 'now', at: state.profile.updatedAt, title: 'Your worldview, now', convictions: convictionsOf(state), interests: state.profile.interests.map(i => i.name), understanding: state.inferred.map(i => `${i.id} · ${Math.round(i.confidence*100)}% confidence`) }];
  const active = Math.min(index ?? frames.length-1, frames.length-1);
  const frame = frames[active];
  const root = useAssembly(frame.id);
  const [echo, setEcho] = useState<string | null>(null);
  const selectedEvent = state.events.find(e => e.id === echo && Date.parse(e.at) <= Date.parse(frame.at));
  const echoThemes = THEMES.filter(t => t.keywords.test(`${selectedEvent?.text ?? ''} ${selectedEvent?.detail ?? ''}`));
  const connected = selectedEvent ? state.events.filter(e => e.id !== selectedEvent.id && Date.parse(e.at) <= Date.parse(frame.at) && (e.tradeId && e.tradeId === selectedEvent.tradeId || echoThemes.some(t => t.keywords.test(`${e.text} ${e.detail ?? ''}`)))) : [];
  const related = state.events.filter(e => Date.parse(e.at) <= Date.parse(frame.at)).slice().sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).slice(0,6);
  return <section className="wv-memory" ref={root}><header className="wv-heading"><div><p className="eyebrow">Memory</p><h1 className="landing-section-title">Revisit your thinking.</h1><p>The decisions that changed your mind. And the ideas that stayed.</p></div><span className="wv-memory-date">{new Date(frame.at).toLocaleDateString(undefined, {month:'long', day:'numeric', year:'numeric'})}</span></header>
    <div className="wv-memory-controls"><button aria-label="Earlier worldview" disabled={active === 0} onClick={() => setIndex(active-1)}><ChevronLeft size={18}/></button><input aria-label="Move through memory" type="range" min={0} max={Math.max(0,frames.length-1)} value={active} disabled={frames.length===1} onChange={e => setIndex(Number(e.target.value))}/><button aria-label="Later worldview" disabled={active===frames.length-1} onClick={() => setIndex(active+1)}><ChevronRight size={18}/></button><button onClick={() => setIndex(null)}>Latest</button></div>
    <div className="wv-memory-spread" data-assemble><div><p className="eyebrow">{active === frames.length-1 ? 'Latest chapter' : 'Looking back'}</p><h2>{frame.title}</h2><p>{memories.length ? 'A recorded snapshot of your beliefs and the agent’s understanding.' : 'History starts with your next conviction change. Earlier activity is preserved below; past beliefs are not reconstructed.'}</p><span className="wv-mini-orb"/></div><div className="wv-memory-beliefs">{frame.convictions.map(c => <div key={c.id}><span style={{width:`${Math.max(5,c.strength*100)}%`}}/><p>{c.text}</p><small>{Math.round(c.strength*100)}% conviction</small></div>)}</div></div>
    <div className="wv-memory-context" data-assemble><section><span className="eyebrow">What held your attention</span><p>{frame.interests.join(' · ') || 'No interests recorded.'}</p></section><section><span className="eyebrow">What your agent understood</span><p>{frame.understanding.join(' · ') || 'Still getting to know you.'}</p></section></div>
    <p className="eyebrow">Echoes from this chapter</p><div className="wv-echoes">{related.map(e => <article key={e.id}><small>{new Date(e.at).toLocaleDateString()} · {e.kind}</small><h3><button className="hub-inline-link" onClick={() => setEcho(echo === e.id ? null : e.id)} aria-expanded={echo === e.id}>{e.text}</button></h3><p>{e.detail}</p>{e.tradeId && <HubLink href="/">Review decision ↗</HubLink>}</article>)}{!related.length && <p className="hub-empty">Meaningful moments will collect here as you explore and decide.</p>}</div>
    {selectedEvent && <div className="wv-memory-chain"><p className="eyebrow">Following the thought · {echoThemes.map(t => t.name).join(' / ') || 'This decision'}</p><h3>{selectedEvent.text}</h3><p>{selectedEvent.detail}</p><div className="wv-echoes">{connected.map(e => <article key={e.id}><small>{new Date(e.at).toLocaleDateString()} · {e.kind}</small><h3>{e.text}</h3><p>{e.detail}</p></article>)}{!connected.length && <p>No other recorded moments share this decision or theme yet.</p>}</div><small>Connected by shared themes or the same trade. This connection does not establish causation.</small></div>}
    {frames.length>1 && <div className="wv-chapters">{frames.map((f,i) => <button key={f.id} aria-pressed={active===i} onClick={() => setIndex(i)}><small>{new Date(f.at).toLocaleDateString()}</small><span>{f.title}</span></button>)}</div>}
  </section>;
}
