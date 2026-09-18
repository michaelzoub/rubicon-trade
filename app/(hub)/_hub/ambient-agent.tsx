"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Square, X } from 'lucide-react';
import { gsap, useGSAP, prefersReducedMotion, rubiconMotion } from '../../_components/motion';
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

/** What counts as “being read”: anything a person interacts with, looks at, or
 * reads, and the surfaces that carry them. Standing on any of it is not allowed. */
const AVOID = 'button, a, input, textarea, select, img, svg, video, canvas, [role="img"], p, h1, h2, h3, h4, h5, h6, li, dt, dd, time, label, small, strong, em, b, i:not(:empty), article, form, table, dl, ol, ul, .hub-quiet-card, .hub-orbit, .hub-orbit-card, .hub-detail-why, .hub-trade, .hub-buy, .hub-disclosure, .hub-lens, .hub-orbs, .hub-composer, .hub-search, .hub-field-panel, .mem-field, .mem-belief, .mem-satellite, [data-agent-avoid]';

export function AmbientAgent({ resolveHref = href => href }: { resolveHref?: (href: string) => string }) {
  const { state, messages, busy, send, stop, error, lastChange, account, agents } = useHub();
  const [open, setOpen] = useState(false);
  /** The thought surface stays in the tree while it animates closed. */
  const [shown, setShown] = useState(false);
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
  /** The wander is one loop for the life of the component. It reads the mood
   * through this ref rather than re-arming on every change: re-arming used to
   * reset the body to its last seat, which is the “teleport” a person saw
   * whenever their pointer drifted near enough to change the agent’s state. */
  const modeNow = useRef<ReturnType<typeof agentState>>('idle');
  const step = useRef<() => void>(() => {});
  const parked = useRef(false);
  const placed = useRef(false);
  const backgroundSeen = useRef(new Set(state.chats.flatMap(c => c.messages.filter(m => m.via === 'background').map(m => m.id))));
  const cooldown = useRef(0), seen = useRef(new Set<string>());
  const id = useId();

  const waiting = state.trades.some(t => t.status === 'approval_required');
  const streaming = messages.some(m => m.status === 'streaming');
  const mode = agentState({ open, busy, streaming, waiting, discovery: !!note, attending: !!attend, reflecting });
  modeNow.current = mode;
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

  useEffect(() => { if (open) { setShown(true); window.dispatchEvent(new CustomEvent('rubicon:attend', { detail: null })); window.dispatchEvent(new Event('rubicon:gloss-hide')); } }, [open]);
  useEffect(() => { if (open && shown) input.current?.focus(); }, [open, shown]);
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
   * is actually drawn where the agent would stand — at its centre and its four
   * corners, so a body cannot half-cover a heading and still count as clear.
   */
  const occupied = useCallback((x: number, y: number) => {
    const main = document.querySelector('main');
    const inset = 6;
    const points = [[x + BODY / 2, y + BODY / 2], [x + inset, y + inset], [x + BODY - inset, y + inset], [x + inset, y + BODY - inset], [x + BODY - inset, y + BODY - inset]];
    return points.some(([px, py]) => {
      // The probe must look through the agent itself, which is what is drawn
      // wherever it already stands.
      const stack = typeof document.elementsFromPoint === 'function' ? document.elementsFromPoint(px, py) : [document.elementFromPoint(px, py)];
      const element = stack.find(node => node && !root.current?.contains(node)) ?? null;
      if (!element) return false;
      // The header and anything floating above the page are never standing room.
      if (element.closest('.site-header, .gloss, .rubicon-tooltip, [role="dialog"], .hub-account, .rubicon-portals')) return true;
      if (!main?.contains(element)) return false;
      if (element.closest(AVOID)) return true;
      return Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim());
    });
  }, []);

  /** The band the agent may stand in: below the header, above the bottom edge. */
  const bounds = useCallback(() => {
    const header = document.querySelector('.site-header')?.getBoundingClientRect();
    const top = Math.max(84, (header?.bottom ?? 72) + 12);
    return { top, bottom: window.innerHeight - BODY - 24 };
  }, []);

  /** Places worth standing: the margins beside content that marks itself. */
  const places = useCallback((): Candidate[] => {
    const width = window.innerWidth, height = window.innerHeight;
    const { top, bottom } = bounds();
    // A phone has no margins at all. The agent keeps to the right edge there,
    // as low as it can go without standing on the composer or a card, rather
    // than crossing content.
    if (width <= 760) {
      const x = width - BODY - 16;
      // Whatever else it overlaps on a crowded phone, never the thing being typed into.
      const composer = document.querySelector('.hub-composer')?.getBoundingClientRect();
      const floor = composer && composer.top < height ? clamp(composer.top - BODY - 10, top, bottom) : bottom;
      for (let y = floor; y >= top; y -= 56) if (!occupied(x, y)) return [{ id: `dock-${Math.round(y)}`, x, y, weight: 1 }];
      return [{ id: 'dock', x, y: floor, weight: 1 }];
    }
    const active = document.activeElement as HTMLElement | null;
    const keepClear = composing.current && active ? active.getBoundingClientRect() : null;
    // The column a person is reading. The agent lives beside it, never on it.
    const column = document.querySelector('main .container')?.getBoundingClientRect()
      ?? document.querySelector('main')?.getBoundingClientRect()
      ?? { left: width / 2, right: width / 2 };
    // While the person writes, the agent keeps out of arm's reach of the input.
    const nearInput = (point: { x: number; y: number }) => !!keepClear && point.x < keepClear.right + 160 && point.x + BODY > keepClear.left - 160 && point.y < keepClear.bottom + 120 && point.y + BODY > keepClear.top - 120;
    const found = Array.from(document.querySelectorAll<HTMLElement>('[data-agent-region]')).flatMap((node, index) => {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.bottom < top || rect.top > height - 40) return [];
      const right = rect.right + 22;
      const x = right + BODY < width - 16 ? right : rect.left - BODY - 22;
      const point = {
        x: keepToGutter(clamp(x, 16, width - BODY - 16), column, width, BODY),
        y: clamp(rect.top + 12, top, bottom),
      };
      if (nearInput(point)) return [];
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

    // Nothing has marked itself, or everything is taken: look at what the page
    // actually leaves empty. A coarse grid is sampled and every clear cell is a
    // place to stand, the ones near the edges weighted heavier so the agent
    // still prefers the margins when the margins exist.
    const columns = [16, width * .22, width * .5, width * .78, width - BODY - 16];
    const rows = 4;
    const spots: Candidate[] = [];
    columns.forEach((cx, ci) => {
      for (let r = 0; r < rows; r++) {
        const point = { x: clamp(cx, 16, width - BODY - 16), y: clamp(top + (bottom - top) * (r + .5) / rows, top, bottom) };
        if (nearInput(point) || occupied(point.x, point.y)) continue;
        const edge = Math.abs(ci - (columns.length - 1) / 2) / ((columns.length - 1) / 2);
        spots.push({ id: `spot-${ci}-${r}`, ...point, weight: .4 + edge * 1.6 });
      }
    });
    if (spots.length) return spots;

    // Truly nowhere: drift the quiet edges anyway, which is at least predictable.
    return [
      { id: 'edge-left', x: 16, y: height * .38, weight: 1 },
      { id: 'edge-right', x: width - BODY - 16, y: height * .3, weight: 1 },
      { id: 'edge-low', x: width - BODY - 16, y: height * .68, weight: 1 },
    ].map(p => ({ ...p, y: clamp(p.y, top, bottom) }));
  }, [occupied, bounds]);

  // The wander. It chooses somewhere, curves there, rests, and chooses again.
  // One loop for the component's life: the mood changes the pace of the next
  // leg, never the position of the body.
  useGSAP(() => {
    const node = root.current;
    if (!node) return;
    let stopped = false;
    let settling: number | undefined;
    if (!placed.current) {
      // The first seat is a real one: somewhere the page leaves empty right
      // now, not a coordinate chosen before the page existed.
      const sit = () => {
        const first = chooseRegion(places(), Math.random());
        const start = first ? { x: first.x, y: first.y } : seat;
        gsap.set(node, start); setSeat(start); region.current = first?.id;
      };
      sit();
      placed.current = true;
      if (!prefersReducedMotion()) {
        // The page is still settling when this runs, so the agent arrives
        // under a fade and its seat is checked again once layout has landed.
        gsap.set(node, { autoAlpha: 0 });
        settling = requestAnimationFrame(() => { settling = requestAnimationFrame(() => {
          if (stopped) return;
          if (occupied(gsap.getProperty(node, 'x') as number, gsap.getProperty(node, 'y') as number)) sit();
          gsap.to(node, { autoAlpha: 1, duration: .7, ease: 'power2.out', clearProps: 'opacity,visibility' });
        }); });
      }
    }
    if (prefersReducedMotion()) return;
    const hold = <T extends gsap.core.Tween>(tween: T) => { if (stillNow.current) tween.pause(); return tween; };
    const rest = (seconds: number) => { parked.current = false; resting.current = hold(gsap.delayedCall(seconds, () => step.current())); };

    step.current = () => {
      if (stopped) return;
      resting.current = null;
      if (document.hidden) { rest(2); return; }
      const mode = modeNow.current;
      // Company and a pending decision both mean: stay exactly where you are.
      if (mode === 'interacting' || mode === 'wanting') { parked.current = true; return; }
      const from = { x: gsap.getProperty(node, 'x') as number, y: gsap.getProperty(node, 'y') as number };
      const target = chooseRegion(places(), Math.random(), region.current);
      if (!target) { rest(4); return; }
      region.current = target.id;
      const distance = Math.hypot(target.x - from.x, target.y - from.y);
      if (distance < 8) { rest(dwellSeconds(mode, Math.random())); return; }
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
          travelling.current = null;
          setSeat({ x: target.x, y: target.y });
          const wait = dwellSeconds(modeNow.current, Math.random());
          if (Number.isFinite(wait)) rest(wait); else parked.current = true;
        },
      }));
      gsap.to(node, { rotation: lean, duration: seconds * .3, ease: 'power2.inOut', overwrite: 'auto' });
      gsap.to(node, { rotation: 0, duration: seconds * .4, ease: 'power2.inOut', delay: seconds * .6 });
    };

    rest(1.2);
    const visibility = () => { if (document.hidden) travelling.current?.pause(); else if (!stillNow.current) travelling.current?.resume(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true; travelling.current?.kill(); resting.current?.kill();
      travelling.current = null; resting.current = null;
      if (settling !== undefined) cancelAnimationFrame(settling);
      document.removeEventListener('visibilitychange', visibility);
      gsap.killTweensOf(node);
    };
  }, { dependencies: [] });

  // A mood that had parked the agent lets it go again once it passes.
  useEffect(() => {
    if (mode === 'interacting' || mode === 'wanting' || !parked.current || prefersReducedMotion()) return;
    parked.current = false;
    resting.current?.kill();
    resting.current = gsap.delayedCall(mode === 'discovering' ? .6 : 1.4, () => step.current());
    if (stillNow.current) resting.current.pause();
  }, [mode]);

  // The page moves under a fixed body when it scrolls. If what it was standing
  // beside has been replaced by something being read, it moves on at once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const node = root.current;
        if (!node || stillNow.current || travelling.current || parked.current || prefersReducedMotion()) return;
        const at = { x: gsap.getProperty(node, 'x') as number, y: gsap.getProperty(node, 'y') as number };
        if (!occupied(at.x, at.y)) return;
        resting.current?.kill();
        step.current();
      }, 160);
    };
    window.addEventListener('scroll', settle, { passive: true, capture: true });
    return () => { clearTimeout(timer); window.removeEventListener('scroll', settle, { capture: true }); };
  }, [occupied]);

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

  // The thought surface unfolds from the body and folds back into it, so the
  // close is a movement rather than a disappearance.
  useGSAP(() => {
    const node = panel.current;
    if (!shown || !node) { summoned.current = false; return; }
    const reduced = prefersReducedMotion();
    if (open) {
      const tween = gsap.fromTo(node, { opacity: 0, y: -10, scale: .95 }, { opacity: 1, y: 0, scale: 1, duration: reduced ? 0 : .5, ease: 'power3.out', overwrite: 'auto' });
      return () => { tween.kill(); };
    }
    if (reduced) { setShown(false); return; }
    const tween = gsap.to(node, { opacity: 0, y: -6, scale: .96, duration: .22, ease: rubiconMotion.ease.exit, overwrite: 'auto', onComplete: () => setShown(false) });
    return () => { tween.kill(); };
  }, { dependencies: [open, shown], scope: root });

  const centre = { x: seat.x + BODY / 2, y: seat.y + BODY / 2 };

  return <div ref={root} className="ambient-agent" data-state={mode} data-open={open} data-held={held || undefined}
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
    onFocusCapture={() => setHeld(true)} onBlurCapture={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) setHeld(false); }}>
    {shown && <section ref={panel} id={id} className="ambient-panel" role="dialog" aria-label="Ask your agent" aria-hidden={!open || undefined} style={open ? undefined : { pointerEvents: 'none' }}>
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
      <footer><HubLink href={resolveHref('/beliefs')} onClick={() => setOpen(false)}>Your beliefs</HubLink><HubLink href={resolveHref('/agents')} onClick={() => setOpen(false)}>Manage agents</HubLink>{account && account.credits.balanceMicros <= 0 && <span>Out of credits</span>}<HubLink href={resolveHref('/')} onClick={() => setOpen(false)}>Full conversation <ArrowUpRight size={12} /></HubLink></footer>
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
