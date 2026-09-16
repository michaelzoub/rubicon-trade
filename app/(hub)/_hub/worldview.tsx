"use client";
import { useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowUpRight, Plus, X } from 'lucide-react';
import { convictionsOf, placement, point, relevance, rotationFor } from '@/lib/socialtrading/worldview';
import type { Asset } from '@/lib/socialtrading/types';
import { gsap, useGSAP, Flip, prefersReducedMotion } from '../../_components/motion';
import { assetGloss, relationWords, useGloss } from './gloss';
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
/** What the field looks like between renders, so a change can be animated as
 * the same objects moving rather than a new page appearing. */
export type FieldSnapshot = RefObject<ReturnType<typeof Flip.getState> | null>;
export const captureField = (snapshot: FieldSnapshot) => { snapshot.current = Flip.getState('.wv-object', { props: 'opacity' }); };

/**
 * The market as somewhere rather than something. Themes hold permanent
 * bearings, so direction is geography a person learns once; distance is how
 * close an idea sits to what they believe; scale and light are how sure the
 * agent is. Nothing is labelled, because position is the label.
 */
export function SpatialMarket({ assets, theme = null, snapshot }: { assets: Asset[]; theme?: string | null; snapshot?: FieldSnapshot }) {
  const { state, userId } = useHub();
  const gloss = useGloss();
  const [selected, select] = useState<Asset>();
  const field = useRef<HTMLDivElement>(null);
  const beliefs = useMemo(() => convictionsOf(state), [state]);
  const rotation = rotationFor(theme);

  const placed = useMemo(() => assets.slice(0, 14)
    .map(asset => ({ asset, place: placement(asset, beliefs, state) }))
    .sort((a, b) => b.place.fit - a.place.fit), [assets, beliefs, state]);
  const key = placed.map(p => `${p.asset.kind}:${p.asset.id}`).join('|');

  // Arrival: each object comes in from beyond the edge along its own bearing,
  // nearest first, so the world assembles by relevance instead of by index.
  useGSAP(() => {
    if (prefersReducedMotion() || snapshot?.current) return;
    const nodes = gsap.utils.toArray<HTMLElement>('.wv-object', field.current);
    nodes.forEach((node, index) => {
      const away = Number(node.dataset.bearing) * Math.PI / 180;
      gsap.fromTo(node,
        { opacity: 0, x: Math.cos(away - Math.PI / 2) * 320, y: Math.sin(away - Math.PI / 2) * 320, scale: .7 },
        { opacity: 1, x: 0, y: 0, scale: 1, duration: 1.1, delay: index * .05, ease: 'creature', clearProps: 'transform' });
    });
  }, { scope: field, dependencies: [key], revertOnUpdate: true });

  // Reorganisation: the same objects travel to their new places. What leaves
  // shrinks outward along its bearing; what arrives comes in along its own.
  useGSAP(() => {
    const previous = snapshot?.current;
    if (!previous) return;
    if (snapshot) snapshot.current = null;
    if (prefersReducedMotion()) return;
    Flip.from(previous, {
      duration: .95, ease: 'power3.inOut', stagger: .015, absolute: true, scale: true,
      onEnter: nodes => gsap.fromTo(nodes, { opacity: 0, scale: .6 }, { opacity: 1, scale: 1, duration: .7, ease: 'creature' }),
      onLeave: nodes => gsap.to(nodes, { opacity: 0, scale: .55, duration: .4, ease: 'power2.in' }),
    });
  }, { scope: field, dependencies: [key, rotation] });

  // Depth: the further from the centre, the more an object drifts, so distance
  // is felt as well as measured.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.utils.toArray<HTMLElement>('.wv-object-drift', field.current).forEach(node => {
      const reach = Number(node.dataset.drift);
      gsap.to(node, {
        x: `random(${-reach}, ${reach})`, y: `random(${-reach}, ${reach})`,
        duration: `random(7, 13)`, repeat: -1, yoyo: true, ease: 'sine.inOut', delay: Math.random() * 3,
      });
    });
  }, { scope: field, dependencies: [key], revertOnUpdate: true });

  // Focusing a theme turns the whole field to face it and moves in a little.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.to(field.current, { scale: theme ? 1.08 : 1, duration: 1.1, ease: 'power3.inOut' });
  }, { dependencies: [theme] });

  return <div className="wv-market">
    <div ref={field} className="wv-space" data-agent-region="market" data-agent-weight="2" aria-label="The market, placed by what you believe">
      <div className="wv-space-wash" aria-hidden="true" />
      <div className="gravity-ring gravity-ring--inner" aria-hidden="true" /><div className="gravity-ring gravity-ring--outer" aria-hidden="true" />
      <HubLink href="/thesis" className="wv-centre" aria-label="You, and what you believe. Open your thesis.">
        <ProfileAvatar profile={state.profile} seed={state.agent?.id ?? userId} themes={state.profile.themes} className="wv-centre-mark" />
      </HubLink>
      {placed.map(({ asset, place }) => {
        const at = point(place, rotation);
        const off = theme ? !asset.themes.includes(theme) : false;
        return <div key={`${asset.kind}:${asset.id}`} className={`wv-object${off ? ' is-off' : ''}`} data-flip-id={`${asset.kind}:${asset.id}`} data-bearing={place.angle}
          style={{ left: `${at.x}%`, top: `${at.y}%`, '--confidence': place.confidence, '--fit': place.fit, '--tether': `${place.angle + 90 + rotation}deg` } as CSSProperties}>
          <span className="wv-object-tether" aria-hidden="true" />
          <span className="wv-object-drift" data-drift={Math.round((1 - place.fit) * 7)}>
            <button type="button" className="wv-object-card" aria-pressed={selected?.id === asset.id}
              aria-label={`${asset.symbol}, ${asset.name}, ${asset.price === null ? 'price unavailable' : usd(asset.price)}. ${relationWords(place.fit)}.`}
              onClick={() => select(asset)} {...gloss(assetGloss(asset, state))}>
              <AssetLogo asset={asset} />
              <b>{asset.symbol}</b>
              <span className="wv-object-quote"><strong>{asset.price === null ? '—' : usd(asset.price)}</strong><ChangeText value={asset.change} /></span>
              <Sparkline points={asset.chart.slice(-30)} width={52} height={15} />
            </button>
          </span>
        </div>;
      })}
      {!assets.length && <p className="wv-no-market">Nothing to place here yet.</p>}
    </div>
    {selected && <DecisionSurface asset={assets.find(a => a.id === selected.id && a.kind === selected.kind) ?? selected} onClose={() => select(undefined)} />}
  </div>;
}
