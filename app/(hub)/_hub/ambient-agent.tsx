"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, ArrowUpRight, Square, X } from 'lucide-react';
import { gsap, useGSAP, prefersReducedMotion } from '../../_components/motion';
import { presenceNote, type PresenceContext } from '@/lib/socialtrading/presence';
import { useHub } from './hub-provider';
import { HubLink } from './navigation';
import './ambient-agent.css';

export function AmbientAgent({ resolveHref = href => href }: { resolveHref?: (href: string) => string }) {
  const { state, messages, busy, send, stop, error, lastChange, account } = useHub();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [reconsidering, setReconsidering] = useState(false);
  const root = useRef<HTMLDivElement>(null), orb = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), input = useRef<HTMLTextAreaElement>(null), log = useRef<HTMLDivElement>(null);
  const [quiet, setQuiet] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [context, setContext] = useState('your thesis');
  const position = useRef({ x: 100, y: 180 });
  const summoned = useRef(false);
  const backgroundSeen = useRef(new Set(state.chats.flatMap(c => c.messages.filter(m => m.via === 'background').map(m => m.id))));
  const cooldown = useRef(0), seen = useRef(new Set<string>());
  const id = useId();
  const waiting = state.trades.some(t => t.status === 'approval_required');
  const streaming = messages.some(m => m.status === 'streaming');
  const mode = assembling ? 'assembling' : busy ? (streaming ? 'acting' : 'researching') : waiting ? 'waiting' : reconsidering ? 'reflecting' : open || focused ? 'listening' : note ? 'noticed' : 'idle';
  const labels = { idle: state.agent?.enabled === false ? 'Background checks paused' : 'Here when you need me', researching: 'Looking into it', acting: 'Working on it', waiting: 'A decision needs you', noticed: 'A thought for you', reflecting: 'Updating my understanding', listening: 'Listening', assembling: 'Making room for your thought' };
  const close = () => { setOpen(false); orb.current?.focus(); };

  useEffect(() => {
    if (!lastChange) return;
    setReconsidering(true);
    const timer = setTimeout(() => setReconsidering(false), 12000);
    return () => clearTimeout(timer);
  }, [lastChange]);
  useEffect(() => { backgroundSeen.current = new Set(state.chats.flatMap(c => c.messages.filter(m => m.via === 'background').map(m => m.id))); seen.current.clear(); cooldown.current = 0; setNote(null); setOpen(false); setDraft(''); }, [state.agent?.id]);
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
    const latest = fresh.at(-1);
    if (latest && state.agent?.enabled !== false && !open && !busy && Date.now() - cooldown.current > 90000) {
      cooldown.current = Date.now();
      setNote('Your agent has a new discovery. Open Activity to see what changed.');
    }
  }, [state.chats, state.agent?.enabled, open, busy]);
  useEffect(() => { if (!note || open) return; const timer = setTimeout(() => setNote(null), 14000); return () => clearTimeout(timer); }, [note, open]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        const target = document.activeElement;
        if (!open && target && target !== document.body && !root.current?.contains(target)) {
          const rect = target.getBoundingClientRect();
          position.current = { x: rect.left, y: rect.bottom + 12 };
        }
        summoned.current = true;
        if (open) close(); else setOpen(true);
      }
      if (event.key === 'Escape' && open) close();
    };
    const outside = (event: PointerEvent) => { if (open && !root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (open && log.current) log.current.scrollTop = log.current.scrollHeight; }, [open, messages]);

  // Content is the anchor; the viewport only supplies collision boundaries.
  useEffect(() => {
    let inactivity: ReturnType<typeof setTimeout>;
    let frame = 0;
    const move = (x: number, y: number) => {
      const width = Math.min(520, window.innerWidth - 32);
      position.current = {
        x: Math.max(16, Math.min(x, window.innerWidth - (open ? width : note ? Math.min(300, window.innerWidth - 40) : 76) - 16)),
        y: Math.max(90, Math.min(y, window.innerHeight - (open ? Math.min(570, window.innerHeight - 112) : note ? 260 : 90) - 16)),
      };
      gsap.to(root.current, { ...position.current, duration: prefersReducedMotion() ? 0 : open ? .55 : 1.4, ease: 'power3.out', overwrite: 'auto' });
    };
    const dock = () => {
      if (open && summoned.current) { move(position.current.x, position.current.y); return; }
      const anchor = document.querySelector('[data-intelligence-anchor]')
        ?? document.querySelector('.wv-decision, .wv-memory-chain')
        ?? document.querySelector('.wv-market-object')
        ?? document.querySelector('.wv-memory-spread')
        ?? document.querySelector('.wv-thesis-layout')
        ?? document.querySelector('main h1');
      const rect = anchor?.getBoundingClientRect();
      setContext(document.querySelector('.wv-market') ? 'your discoveries' : document.querySelector('.wv-memory') ? 'your evolving perspective' : 'your thesis');
      move(rect ? rect.right + 18 : window.innerWidth * .7, rect ? rect.top + 12 : 180);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(dock); };
    const active = () => { setQuiet(false); clearTimeout(inactivity); inactivity = setTimeout(() => setQuiet(true), 24000); };
    const magnet = (event: PointerEvent | FocusEvent) => {
      active();
      if (open) return;
      const anchor = (event.target as Element)?.closest?.('[data-intelligence-anchor], .wv-market-object, .wv-theme-object, .wv-echoes article, .wv-memory-spread, .wv-thesis-layout');
      if (anchor) { const rect = anchor.getBoundingClientRect(); move(rect.right + 16, rect.top + 8); }
    };
    const summon = () => { summoned.current = true; setOpen(true); };
    const observer = new MutationObserver(schedule);
    const main = document.querySelector('main');
    if (main) observer.observe(main, { childList: true, subtree: true });
    dock(); active();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('rubicon:summon', summon);
    document.addEventListener('pointerover', magnet);
    document.addEventListener('focusin', magnet);
    document.addEventListener('keydown', active);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(inactivity);
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('rubicon:summon', summon);
      document.removeEventListener('pointerover', magnet); document.removeEventListener('focusin', magnet); document.removeEventListener('keydown', active);
      gsap.killTweensOf(root.current);
    };
  }, [open, note]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const energy = { idle: .3, listening: .55, researching: .8, noticed: .9, waiting: .45, assembling: 1, acting: .7, reflecting: .5 }[mode];
      const animation = gsap.timeline({ repeat: -1, yoyo: true })
        .to('.ambient-core', { y: mode === 'idle' ? -4 : -2, scale: 1 + energy * .1, rotation: mode === 'reflecting' ? -24 : energy * 25, duration: 5 - energy * 2.5, ease: 'sine.inOut' }, 0)
        .to('.ambient-halo', { scale: 1.1 + energy * .3, opacity: energy, duration: 5 - energy * 2.5, ease: 'sine.inOut' }, 0)
        .to('.ambient-orbit', { rotation: mode === 'researching' ? 150 : -30, scaleY: mode === 'reflecting' ? .45 : .8, duration: 7, ease: 'sine.inOut' }, 0);
      const visibility = () => document.hidden ? animation.pause() : animation.resume();
      visibility(); document.addEventListener('visibilitychange', visibility);
      return () => document.removeEventListener('visibilitychange', visibility);
    });
    return () => media.revert();
  }, { scope: root, dependencies: [mode], revertOnUpdate: true });
  useGSAP(() => {
    if (!open || !panel.current) { summoned.current = false; setAssembling(false); return; }
    setAssembling(true);
    const tween = gsap.fromTo(panel.current, { opacity: 0, y: -12, scale: .94 }, { opacity: 1, y: 0, scale: 1, duration: prefersReducedMotion() ? 0 : .55, ease: 'power3.out', onComplete: () => setAssembling(false) });
    return () => { tween.kill(); };
  }, { dependencies: [open], scope: root });

  return <div ref={root} className="ambient-agent" data-state={mode} data-quiet={quiet && !open && mode === 'idle'} data-open={open}>
    {open && <section ref={panel} id={id} className="ambient-panel" role="dialog" aria-label="Ask your agent">
      <header><div><span className="ambient-eyebrow">RUBICON INTELLIGENCE</span><h2>A space to think.</h2></div><button aria-label="Close agent" onClick={close}><X size={17} /></button></header>
      <div ref={log} className="ambient-log">
        {note && <p className="ambient-thought">{note}</p>}
        {!messages.length && <div className="ambient-empty"><h3>What’s on<br />your mind?</h3><p>Follow a curiosity. Test a conviction. See a little further.</p></div>}
        {messages.slice(-6).map(message => <div key={message.id} className={`ambient-message is-${message.role}`}><small>{message.role === 'user' ? 'You' : state.agent?.name ?? 'Your agent'}</small>{message.parts.map((part, index) => part.type === 'text' || part.type === 'notice' ? <p key={index}>{part.text}</p> : <HubLink className="ambient-detail-link" key={index} href={resolveHref(part.type === 'trade' ? '/activity' : '/')} onClick={() => setOpen(false)}>{part.type === 'trade' ? 'Review trade' : 'View supporting details'} <ArrowUpRight size={12} /></HubLink>)}</div>)}
      </div>
      {!busy && <div className="ambient-prompts">{(context === 'your discoveries' ? ['How do these ideas fit my thesis?', 'What deserves a closer look?'] : context === 'your evolving perspective' ? ['What changed in my thinking?', 'Challenge my thesis'] : ['Challenge my thesis', 'What am I overlooking?']).map(prompt => <button key={prompt} onClick={() => { setDraft(prompt); input.current?.focus(); }}>{prompt}<ArrowUpRight size={12}/></button>)}</div>}
      <p className="ambient-status" role="status">{error ?? labels[mode]} {waiting && <HubLink href={resolveHref("/activity")} onClick={() => setOpen(false)}>Review activity ↗</HubLink>}</p>
      <form onSubmit={event => { event.preventDefault(); if (draft.trim() && !busy && (!account || account.credits.balanceMicros > 0)) { void send(draft); setDraft(''); setNote(null); } }}>
        <textarea rows={2} ref={input} aria-label="Ask your agent" placeholder="A question, a thought…" value={draft} maxLength={4000} onChange={e => setDraft(e.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} disabled={!!account && account.credits.balanceMicros <= 0} />
        {busy ? <button type="button" onClick={stop} aria-label="Stop response"><Square size={14} /></button> : <button disabled={!draft.trim() || (!!account && account.credits.balanceMicros <= 0)} aria-label="Send message"><ArrowUp size={17} /></button>}
      </form>
      <footer><HubLink href={resolveHref('/thesis')} onClick={() => setOpen(false)}>Your thesis</HubLink><HubLink href={resolveHref('/agents')} onClick={() => setOpen(false)}>Manage agents</HubLink><span>{account && account.credits.balanceMicros <= 0 ? 'Out of credits' : `In the context of ${context}`}</span><HubLink href={resolveHref('/')} onClick={() => setOpen(false)}>Full conversation <ArrowUpRight size={12} /></HubLink></footer>
    </section>}
    {!open && note && <div className="ambient-nudge"><button className="ambient-nudge-copy" onClick={() => setOpen(true)}>{note}<span>Think it through <ArrowUpRight size={12} /></span></button><button aria-label="Dismiss thought" onClick={() => setNote(null)}><X size={13} /></button></div>}
    <div className="ambient-dock"><span className="ambient-caption" aria-live="polite">{labels[mode]}</span>
      <button ref={orb} className="ambient-orb" aria-label={`${labels[mode]}. Open agent. Shortcut Control or Command J. Summon from anywhere.`} aria-keyshortcuts="Control+j Meta+j" aria-expanded={open} aria-controls={open ? id : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onMouseEnter={() => setFocused(true)} onMouseLeave={() => setFocused(false)}
        onClick={() => { summoned.current = true; setOpen(value => !value); }}>
        <span className="ambient-halo" /><span className="ambient-core"><span /></span><span className="ambient-orbit" />
      </button>
    </div>
  </div>;
}
