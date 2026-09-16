"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Square, X } from 'lucide-react';
import { gsap, useGSAP, prefersReducedMotion } from '../../_components/motion';
import { presenceNote, type PresenceContext } from '@/lib/socialtrading/presence';
import { AGENT_LABEL, agentState, along, arc, bowAway, chooseRegion, dwellSeconds, keepToGutter, travelSeconds, type Candidate } from '@/lib/socialtrading/agent-state';
import { agentAvatarTraits } from '@/lib/socialtrading/avatar';
import { identityPalette } from '@/lib/socialtrading/identity-palette';
import { identityDepth, identityStats } from '@/lib/socialtrading/identity';
import { convictionsOf } from '@/lib/socialtrading/worldview';
import { AgentCreature } from './agent-creature';
import { useHub } from './hub-provider';
import { HubLink } from './navigation';
import './ambient-agent.css';

/** Roughly the creature's own size, used to keep it inside the viewport and
 * out of the way of whatever it is standing next to. */
const BODY = 52;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function AmbientAgent({ resolveHref = href => href }: { resolveHref?: (href: string) => string }) {
  const { state, messages, busy, send, stop, error, lastChange, account, agents } = useHub();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);
  const [attend, setAttend] = useState<{ x: number; y: number } | null>(null);
  const [seat, setSeat] = useState({ x: 120, y: 220 });
  /** Pointer or focus is on the agent: it holds still to be caught. */
  const [held, setHeld] = useState(false);
  const root = useRef<HTMLDivElement>(null), orb = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLDivElement>(null), body = useRef<HTMLSpanElement>(null);
  const summoned = useRef(false);
  const composing = useRef(false);
  const region = useRef<string | undefined>(undefined);
  const travelling = useRef<gsap.core.Tween | null>(null);
  const resting = useRef<gsap.core.Tween | null>(null);
  const backgroundSeen = useRef(new Set(state.chats.flatMap(c => c.messages.filter(m => m.via === 'background').map(m => m.id))));
  const cooldown = useRef(0), seen = useRef(new Set<string>());
  const id = useId();

  const waiting = state.trades.some(t => t.status === 'approval_required');
  const streaming = messages.some(m => m.status === 'streaming');
  const mode = agentState({ open, busy, streaming, waiting, discovery: !!note, attending: !!attend, reflecting });
  const label = AGENT_LABEL[mode];
  const close = useCallback(() => { setOpen(false); orb.current?.focus(); }, []);

  const traits = agentAvatarTraits(state.agent?.id ?? 'default', state.profile);
  const palette = useMemo(() => identityPalette(
    state.agent?.id ?? 'default',
    state.profile.themes,
    state.inferred,
    identityDepth(state, identityStats(state, agents?.length ? agents : state.agent ? [state.agent] : [])),
  ), [state, agents]);

  // Openers come from what the person actually believes, not from a stock list.
  const prompts = useMemo(() => {
    const beliefs = convictionsOf(state);
    const first = beliefs[0]?.text.replace(/[.!?]\s*$/, '');
    return [first ? `Challenge “${first.length > 52 ? `${first.slice(0, 52)}…` : first}”` : 'Challenge my thesis', 'What am I overlooking?'];
  }, [state]);

  useEffect(() => {
    if (!lastChange) return;
    setReflecting(true);
    const timer = setTimeout(() => setReflecting(false), 9000);
    return () => clearTimeout(timer);
  }, [lastChange]);

  useEffect(() => {
    backgroundSeen.current = new Set(state.chats.flatMap(c => c.messages.filter(m => m.via === 'background').map(m => m.id)));
    seen.current.clear(); cooldown.current = 0; setNote(null); setOpen(false); setDraft('');
  }, [state.agent?.id]);

  useEffect(() => {
    const receive = (event: Event) => {
      const context = (event as CustomEvent<PresenceContext>).detail;
      const key = `${context.kind}:${context.asset.id}`;
      if (state.agent?.enabled === false || seen.current.has(key) || Date.now() - cooldown.current < 90000 || open || busy) return;
      seen.current.add(key); cooldown.current = Date.now(); setNote(presenceNote(state, context));
    };
    window.addEventListener('rubicon:presence', receive);
    return () => window.removeEventListener('rubicon:presence', receive);
  }, [state, open, busy]);

  useEffect(() => {
    const fresh = state.chats.flatMap(c => c.messages).filter(m => m.via === 'background' && !backgroundSeen.current.has(m.id));
    fresh.forEach(m => backgroundSeen.current.add(m.id));
    if (fresh.length && state.agent?.enabled !== false && !open && !busy && Date.now() - cooldown.current > 90000) {
      cooldown.current = Date.now();
      setNote('Your agent found something while you were away.');
    }
  }, [state.chats, state.agent?.enabled, open, busy]);

  useEffect(() => { if (!note || open) return; const timer = setTimeout(() => setNote(null), 14000); return () => clearTimeout(timer); }, [note, open]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); summoned.current = true; if (open) close(); else setOpen(true); }
      if (event.key === 'Escape' && open) close();
    };
    const outside = (event: PointerEvent) => { if (open && !root.current?.contains(event.target as Node)) setOpen(false); };
    const summon = () => { summoned.current = true; setOpen(true); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
    window.addEventListener('rubicon:summon', summon);
    return () => {
      document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside);
      window.removeEventListener('rubicon:summon', summon);
    };
  }, [open, close]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [open, messages]);

  // Reaching for the agent stops it, and so does opening it: nothing that a
  // person is trying to touch or read should still be moving.
  const still = open || held;
  const stillNow = useRef(still);
  useEffect(() => {
    stillNow.current = still;
    if (still) { travelling.current?.pause(); resting.current?.pause(); }
    else { travelling.current?.resume(); resting.current?.resume(); }
  }, [still]);

  // Opening it makes room: the agent moves to wherever the thought surface
  // fits whole, so the conversation is never half off the screen.
  useEffect(() => {
    if (!open || !root.current) return;
    const panel = { width: Math.min(520, window.innerWidth - 32), height: Math.min(570, window.innerHeight - 112) };
    const at = {
      x: clamp(gsap.getProperty(root.current, 'x') as number, 16, Math.max(16, window.innerWidth - panel.width - 16)),
      y: clamp(gsap.getProperty(root.current, 'y') as number, 90, Math.max(90, window.innerHeight - panel.height - 16)),
    };
    gsap.to(root.current, { ...at, duration: prefersReducedMotion() ? 0 : .45, ease: 'power3.out', overwrite: 'auto' });
    setSeat(at);
  }, [open]);

  // However the window changes, the agent stays inside it.
  useEffect(() => {
    const fit = () => {
      if (!root.current) return;
      const at = {
        x: clamp(gsap.getProperty(root.current, 'x') as number, 16, Math.max(16, window.innerWidth - BODY - 16)),
        y: clamp(gsap.getProperty(root.current, 'y') as number, 84, Math.max(84, window.innerHeight - BODY - 24)),
      };
      gsap.set(root.current, at);
      setSeat(at);
    };
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Looking without going. Whatever the person is reading pulls the agent's
  // attention, and only its attention: the body stays wherever it was.
  useEffect(() => {
    const look = (event: Event) => setAttend((event as CustomEvent<{ x: number; y: number } | null>).detail ?? null);
    const track = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      composing.current = event.type === 'focusin' && !!target?.matches?.('textarea, input:not([type=checkbox]):not([type=radio])');
    };
    window.addEventListener('rubicon:attend', look);
    document.addEventListener('focusin', track); document.addEventListener('focusout', track);
    return () => {
      window.removeEventListener('rubicon:attend', look);
      document.removeEventListener('focusin', track); document.removeEventListener('focusout', track);
    };
  }, []);

  /**
   * Whether a place is already taken. Layouts that run edge to edge leave no
   * margin to reason about, so rather than assume one, this asks the page what
   * is actually drawn at the point the agent would stand on.
   */
  const occupied = useCallback((x: number, y: number) => {
    const element = document.elementFromPoint(x + BODY / 2, y + BODY / 2);
    if (!element || root.current?.contains(element)) return false;
    if (!document.querySelector('main')?.contains(element)) return false;
    if (element.closest('button, a, input, textarea, img, svg, [role="img"]')) return true;
    return Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim());
  }, []);

  /** Places worth standing: the margins beside content that marks itself. */
  const places = useCallback((): Candidate[] => {
    const width = window.innerWidth, height = window.innerHeight;
    const active = document.activeElement as HTMLElement | null;
    const keepClear = composing.current && active ? active.getBoundingClientRect() : null;
    // The column a person is reading. The agent lives beside it, never on it.
    const column = document.querySelector('main .container')?.getBoundingClientRect()
      ?? document.querySelector('main')?.getBoundingClientRect()
      ?? { left: width / 2, right: width / 2 };
    const found = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-region]')).flatMap((node, index) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < 40 || rect.top > height - 40) return [];
      const right = rect.right + 22;
      const x = right + BODY < width - 16 ? right : rect.left - BODY - 22;
      const point = {
        x: keepToGutter(clamp(x, 16, width - BODY - 16), column, width, BODY),
        y: clamp(rect.top + 12, 84, height - BODY - 24),
      };
      // While the person writes, the agent keeps out of arm's reach of the input.
      if (keepClear && point.x < keepClear.right + 160 && point.x + BODY > keepClear.left - 160 && point.y < keepClear.bottom + 120 && point.y + BODY > keepClear.top - 120) return [];
      return [{ id: `${node.dataset.agentRegion ?? 'region'}-${index}`, ...point, weight: Number(node.dataset.agentWeight ?? 1) || 1 }];
    });
    // A place that is taken is tried again hard against the nearest edge, where
    // there is most often nothing drawn, before it is given up on.
    const free = found.flatMap(place => {
      if (!occupied(place.x, place.y)) return [place];
      const edged = { ...place, x: place.x < width / 2 ? 16 : width - BODY - 16 };
      return occupied(edged.x, edged.y) ? [] : [edged];
    });
    if (free.length) return free;

    // Nothing has marked itself, or everything is taken: drift the quiet edges.
    const edges = [
      { id: 'edge-left', x: 28, y: height * .38, weight: 1 },
      { id: 'edge-right', x: width - BODY - 28, y: height * .3, weight: 1 },
      { id: 'edge-low', x: width - BODY - 60, y: height * .68, weight: 1 },
    ].map(p => ({ ...p, x: keepToGutter(clamp(p.x, 16, width - BODY - 16), column, width, BODY), y: clamp(p.y, 84, height - BODY - 24) }));
    const open = edges.filter(p => !occupied(p.x, p.y));
    return open.length ? open : edges;
  }, [occupied]);

  // The wander. It chooses somewhere, curves there, rests, and chooses again.
  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    gsap.set(node, { x: seat.x, y: seat.y });
    if (prefersReducedMotion()) return;
    let stopped = false;
    const hold = <T extends gsap.core.Tween>(tween: T) => { if (stillNow.current) tween.pause(); return tween; };

    const step = () => {
      if (stopped || document.hidden) { resting.current = hold(gsap.delayedCall(2, step)); return; }
      const from = { x: gsap.getProperty(node, 'x') as number, y: gsap.getProperty(node, 'y') as number };
      const target = chooseRegion(places(), Math.random(), region.current);
      if (!target) { resting.current = hold(gsap.delayedCall(4, step)); return; }
      region.current = target.id;
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      const seconds = travelSeconds(distance, mode, composing.current);
      const lean = clamp((target.x - from.x) / 90, -7, 7);
      // Bowing away from the middle keeps the journey in the margins too, not
      // just its destination. The curve is walked directly, so a missing plugin
      // can never leave the agent sitting still while its posture animates.
      const path = arc(from, target, bowAway(from, target, window.innerWidth / 2));
      const progress = { at: 0 };
      travelling.current = hold(gsap.to(progress, {
        at: 1, duration: seconds, ease: 'creature',
        onUpdate: () => gsap.set(node, along(path, progress.at)),
        onComplete: () => {
          setSeat({ x: target.x, y: target.y });
          const wait = dwellSeconds(mode, Math.random());
          if (Number.isFinite(wait)) resting.current = hold(gsap.delayedCall(wait, step));
        },
      }));
      gsap.to(node, { rotation: lean, duration: seconds * .3, ease: 'power2.inOut' });
      gsap.to(node, { rotation: 0, duration: seconds * .4, ease: 'power2.inOut', delay: seconds * .6 });
    };

    resting.current = hold(gsap.delayedCall(1.2, step));
    const visibility = () => { if (document.hidden) travelling.current?.pause(); else if (!stillNow.current) travelling.current?.resume(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true; travelling.current?.kill(); resting.current?.kill();
      travelling.current = null; resting.current = null;
      document.removeEventListener('visibilitychange', visibility);
      gsap.killTweensOf(node);
    };
    // The loop re-arms on state change so urgency and pace follow the agent's mood.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, { dependencies: [mode, places] });

  // Breathing, under everything else.
  useGSAP(() => {
    if (prefersReducedMotion()) return;
    const energy = { idle: .25, observing: .4, thinking: .75, discovering: .95, wanting: .8, interacting: .5 }[mode];
    const loop = gsap.timeline({ repeat: -1, yoyo: true })
      .to(body.current, { y: -3 - energy * 3, scale: 1 + energy * .05, duration: 3.4 - energy * 1.6, ease: 'breath' }, 0)
      .to('.ambient-glow', { scale: 1.06 + energy * .26, opacity: .28 + energy * .5, duration: 3.4 - energy * 1.6, ease: 'breath' }, 0);
    const visibility = () => document.hidden ? loop.pause() : loop.resume();
    document.addEventListener('visibilitychange', visibility);
    return () => { loop.kill(); document.removeEventListener('visibilitychange', visibility); };
  }, { scope: root, dependencies: [mode], revertOnUpdate: true });

  useGSAP(() => {
    if (!open || !panel.current) { summoned.current = false; return; }
    const tween = gsap.fromTo(panel.current, { opacity: 0, y: -10, scale: .95 }, { opacity: 1, y: 0, scale: 1, duration: prefersReducedMotion() ? 0 : .5, ease: 'power3.out' });
    return () => { tween.kill(); };
  }, { dependencies: [open], scope: root });

  const centre = { x: seat.x + BODY / 2, y: seat.y + BODY / 2 };

  return <div ref={root} className="ambient-agent" data-state={mode} data-open={open} data-held={held || undefined}
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
    onFocusCapture={() => setHeld(true)} onBlurCapture={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) setHeld(false); }}>
    {open && <section ref={panel} id={id} className="ambient-panel" role="dialog" aria-label="Ask your agent">
      <header><button aria-label="Close agent" onClick={close}><X size={17} /></button></header>
      <div ref={log} className="ambient-log">
        {note && <p className="ambient-thought">{note}</p>}
        {!messages.length && <div className="ambient-empty"><h3>What’s on<br />your mind?</h3></div>}
        {messages.slice(-6).map(message => <div key={message.id} className={`ambient-message is-${message.role}`}><small>{message.role === 'user' ? 'You' : state.agent?.name ?? 'Your agent'}</small>{message.parts.map((part, index) => part.type === 'text' || part.type === 'notice' ? <p key={index}>{part.text}</p> : <HubLink className="ambient-detail-link" key={index} href={resolveHref(part.type === 'trade' ? '/activity' : '/')} onClick={() => setOpen(false)}>{part.type === 'trade' ? 'Review trade' : 'View supporting details'} <ArrowUpRight size={12} /></HubLink>)}</div>)}
      </div>
      {!busy && <div className="ambient-prompts">{prompts.map(prompt => <button key={prompt} onClick={() => { setDraft(prompt); input.current?.focus(); }}>{prompt}<ArrowUpRight size={12}/></button>)}</div>}
      <p className="ambient-status" role="status">{error ?? label} {waiting && <HubLink href={resolveHref("/activity")} onClick={() => setOpen(false)}>Review the decision ↗</HubLink>}</p>
      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !busy && (!account || account.credits.balanceMicros > 0)) { void send(draft); setDraft(''); setNote(null); } }}>
        <textarea rows={2} ref={input} aria-label="Ask your agent" placeholder="A question, a thought…" value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!!account && account.credits.balanceMicros <= 0} />
        {busy ? <button type="button" onClick={stop} aria-label="Stop response"><Square size={14} /></button> : <button disabled={!draft.trim() || (!!account && account.credits.balanceMicros <= 0)} aria-label="Send message"><ArrowUp size={17} /></button>}
      </form>
      <footer><HubLink href={resolveHref('/thesis')} onClick={() => setOpen(false)}>Your thesis</HubLink><HubLink href={resolveHref('/agents')} onClick={() => setOpen(false)}>Manage agents</HubLink>{account && account.credits.balanceMicros <= 0 && <span>Out of credits</span>}<HubLink href={resolveHref('/')} onClick={() => setOpen(false)}>Full conversation <ArrowUpRight size={12} /></HubLink></footer>
    </section>}
    {!open && note && <div className="ambient-nudge"><button className="ambient-nudge-copy" onClick={() => setOpen(true)}>{note}<span>Think it through <ArrowUpRight size={12} /></span></button><button aria-label="Dismiss thought" onClick={() => setNote(null)}><X size={13} /></button></div>}
    <button ref={orb} className="ambient-orb" aria-label={`${label}. Open agent. Shortcut Control or Command J.`} aria-keyshortcuts="Control+j Meta+j" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { summoned.current = true; setOpen(value => !value); }}>
      <span className="ambient-glow" aria-hidden="true" />
      <span ref={body} className="ambient-body">
        <AgentCreature traits={traits} palette={palette} expression={mode} lookAt={{ from: centre, to: attend }} className="ambient-creature" />
      </span>
      <span className="sr-only" aria-live="polite">{label}</span>
    </button>
  </div>;
}
