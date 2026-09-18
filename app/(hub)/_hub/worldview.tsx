"use client";
import { useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { convictionsOf, placement, point, relevance, rotationFor } from '@/lib/socialtrading/worldview';
import type { Asset } from '@/lib/socialtrading/types';
import { gsap, useGSAP, Flip, prefersReducedMotion } from '../../_components/motion';
import { assetGloss, relationWords, useGloss } from './gloss';
import { ProfileAvatar } from '../profile-avatar';
import { useHub } from './hub-provider';
import { HubLink, useHubRouter } from './navigation';
import { assetHref, AssetLogo, Sparkline, ChangeText } from './parts';
import { usd } from './format';
import { openPurchase } from './purchase';
import './worldview.css';
import { BeliefsGraph } from './beliefs-graph';
import { WalletHoldings } from './wallet-holdings';

function useAssembly(key: unknown) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.fromTo(root.current?.querySelectorAll('[data-assemble]') ?? [], { opacity: 0, y: 14, filter: 'blur(4px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: .7, stagger: .07, clearProps: 'all' }); });
    return () => media.revert();
  }, { scope: root, dependencies: [key], revertOnUpdate: true });
  return root;
}
export function BeliefsView({ compact = false }: { compact?: boolean }) {
  return <section className="wv-thesis">
    <header className="wv-heading wv-heading-bare"><HubLink href={compact ? '/beliefs' : '/profile'} className="button button-secondary button-nav">{compact ? 'Open your beliefs' : 'Edit your beliefs'} <ArrowUpRight size={14}/></HubLink></header>
    <BeliefsGraph />
    {!compact && <WalletHoldings />}
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
      <section data-assemble><span>01 / YOUR BELIEF</span><h3>{belief?.text ?? 'No direct belief connection yet.'}</h3><p>{belief?.origin ?? 'Treat this as a discovery, rather than an established fit.'}</p></section>
      <section data-assemble><span>02 / THE SIGNAL</span>{asset ? <><h3>{asset.news[0]?.title ?? asset.label ?? asset.name}</h3><p>{asset.reason ?? asset.description ?? 'The available market data does not yet explain the move.'}</p>{asset.news[0] && <a href={asset.news[0].url} target="_blank" rel="noreferrer">Read source ↗</a>}<small>{asset.source} · {asset.asOf ? new Date(asset.asOf).toLocaleString() : 'Timestamp unavailable'}</small></> : <p>{busy ? 'Your agent is gathering evidence…' : response?.parts.filter(p => p.type === 'text').map(p => p.text).join('\n') || 'Ask your agent to gather evidence for this question.'}</p>}</section>
      <section data-assemble><span>03 / WHY IT MATTERS</span><h3>{belief ? 'Test the belief behind the interest.' : 'Find the connection first.'}</h3><p>{reasons.join(' ') || asset?.reason || 'Separate a change in the underlying business from a change in its market price.'}</p><span>WHAT REMAINS OPEN</span><p>A price move alone cannot confirm or disprove your belief. The cause, duration, and effect on your assumptions still need checking.</p></section>
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
  const { state, userId, signal } = useHub();
  const gloss = useGloss();
  const router = useHubRouter();
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
      <HubLink href="/beliefs" className="wv-centre" aria-label="You, and what you believe. Open your beliefs.">
        <ProfileAvatar profile={state.profile} seed={state.agent?.id ?? userId} themes={state.profile.themes} className="wv-centre-mark" />
      </HubLink>
      {placed.map(({ asset, place }) => {
        const at = point(place, rotation);
        const off = theme ? !asset.themes.includes(theme) : false;
        return <div key={`${asset.kind}:${asset.id}`} className={`wv-object${off ? ' is-off' : ''}`} data-flip-id={`${asset.kind}:${asset.id}`} data-bearing={place.angle}
          style={{ left: `${at.x}%`, top: `${at.y}%`, '--confidence': place.confidence, '--fit': place.fit, '--tether': `${place.angle + 90 + rotation}deg` } as CSSProperties}>
          <span className="wv-object-tether" aria-hidden="true" />
          <span className="wv-object-drift" data-drift={Math.round((1 - place.fit) * 7)}>
            <button type="button" className={`gravity-asset wv-object-card${place.fit < .1 ? ' is-rejected' : ''}`}
              aria-label={`${asset.symbol}, ${asset.name}, ${asset.price === null ? 'price unavailable' : usd(asset.price)}. ${relationWords(place.fit)}. Open.`}
              onClick={() => { void signal('opened', asset); router.push(assetHref(asset)); }} {...gloss(assetGloss(asset, state))}>
              <span className="gravity-asset-head">
                <AssetLogo asset={asset} />
                <span><b>{asset.symbol}</b><span className="gravity-name">{asset.name}</span></span>
                <span className="gravity-confidence" title={place.confidence ? `${Math.round(place.confidence * 100)}% agent confidence in the connected theme` : 'Agent confidence not established'} />
              </span>
              <span className="gravity-quote"><strong>{asset.price === null ? 'Unavailable' : usd(asset.price)}</strong><ChangeText value={asset.change} /></span>
              <span className="gravity-signal">
                <Sparkline points={asset.chart.slice(-30)} width={55} height={16} />
                <small>{place.fit < .1 ? 'Set aside' : place.confidence ? `${Math.round(place.confidence * 100)}% confidence` : 'New connection'}</small>
              </span>
            </button>
          </span>
        </div>;
      })}
      {!assets.length && <p className="wv-no-market">Nothing to place here yet.</p>}
    </div>
  </div>;
}
