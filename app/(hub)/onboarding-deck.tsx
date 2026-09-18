"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, BriefcaseBusiness, Coins, Globe2, HeartPulse, RotateCcw, Sprout, Zap } from "lucide-react";
import { CATEGORIES, predictions } from "@/lib/socialtrading/onboarding";
import { commitOf, forceOf, leanOf, poseOf, type Direction } from "@/lib/socialtrading/onboarding-throw";
import { Draggable, gsap, prefersReducedMotion, rubiconMotion, useGSAP } from "../_components/motion";
import { fetchPredictionDeck, type DeckFetcher } from "./onboarding-client";

/** Positional with CATEGORIES, so a domain looks the same wherever it appears. */
export const CATEGORY_ICONS = [Bot, Zap, Coins, HeartPulse, Globe2, Sprout, BriefcaseBusiness];
export const SECTOR_KEYS = ["tech", "energy", "money", "health", "gov", "climate", "work"] as const;
export const iconFor = (category: string) => CATEGORY_ICONS[Math.max(0, CATEGORIES.indexOf(category))];
export const sectorKey = (category: string) => SECTOR_KEYS[Math.max(0, CATEGORIES.indexOf(category))];

export type { Direction };
export type DeckCard = { id: string; category: string; text: string; lead?: string };

function paint(deck: HTMLElement | null, x: number, y: number) {
  if (!deck) return;
  const lean = leanOf(x, y);
  deck.style.setProperty("--force", String(forceOf(x, y)));
  if (lean) deck.setAttribute("data-lean", lean);
  else deck.removeAttribute("data-lean");
}

/** A deck you throw rather than a form you fill. The top card tracks the
 * pointer and tilts into the label it is heading for — left, right, or down —
 * so a tap on that label and a flick are the same move. */
export function PredictionDeck({ card, backs = 0, answered, total, onVote, onUndo }: {
  card: DeckCard; backs?: number;
  answered?: number; total?: number;
  onVote: (direction: Direction) => Promise<void> | void; onUndo?: () => void;
}) {
  const deck = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const onVoteRef = useRef(onVote);
  const locked = useRef(false);
  const invite = useRef<gsap.core.Tween | null>(null);
  const [exiting, setExiting] = useState(false);
  const [hinting, setHinting] = useState(true);
  onVoteRef.current = onVote;
  const Icon = iconFor(card.category);
  const sector = sectorKey(card.category);
  const quiet = prefersReducedMotion();

  async function fly(direction: Direction) {
    if (locked.current) return;
    locked.current = true;
    invite.current?.kill();
    invite.current = null;
    setHinting(false);
    setExiting(true);
    paint(deck.current, direction === "yes" ? 160 : direction === "no" ? -160 : 0, direction === "unsure" ? 160 : 0);
    const el = top.current;
    if (el && !quiet) {
      const x = direction === "yes" ? 640 : direction === "no" ? -640 : Number(gsap.getProperty(el, "x")) || 0;
      const y = direction === "unsure" ? 460 : Number(gsap.getProperty(el, "y")) || 40;
      await gsap.to(el, { x, y, rotation: direction === "yes" ? 26 : direction === "no" ? -26 : 0, opacity: 0, scale: 0.9, duration: rubiconMotion.duration.state, ease: "power3.in" });
    }
    locked.current = false;
    setExiting(false);
    await onVoteRef.current(direction);
  }

  useGSAP(() => {
    const el = top.current;
    const stage = deck.current;
    if (!el || !stage) return;
    locked.current = false;
    paint(stage, 0, 0);
    if (quiet) return;
    gsap.set(el, { x: 0, y: 0, rotation: 0, rotationX: 0, opacity: 1, scale: 1, transformOrigin: "50% 50%" });
    gsap.fromTo(el, { y: 28, rotation: -4, scale: 0.96, opacity: 0 }, {
      y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.48, ease: "creature",
    });
    if (hinting) {
      invite.current = gsap.to(el, {
        rotation: 3.2, duration: 0.9, ease: "sine.inOut",
        yoyo: true, repeat: 5, delay: 0.55, repeatDelay: 0.28,
      });
    }

    const stopHint = () => {
      invite.current?.kill();
      invite.current = null;
      setHinting(false);
    };

    const [drag] = Draggable.create(el, {
      type: "x,y", inertia: false, allowNativeTouchScrolling: false, zIndexBoost: false,
      onPress() {
        stopHint();
        if (!locked.current) gsap.to(el, { scale: 1.045, duration: rubiconMotion.duration.micro, ease: "power2.out" });
      },
      onDrag() {
        if (locked.current) return;
        const pose = poseOf(this.x, this.y);
        gsap.set(el, { rotation: pose.rotation, rotationX: pose.rotationX });
        paint(stage, this.x, this.y);
      },
      onRelease() {
        if (locked.current) return;
        gsap.to(el, { scale: 1, duration: rubiconMotion.duration.micro, ease: "power2.out" });
        let vx = 0, vy = 0;
        try { vx = this.getVelocity("x"); vy = this.getVelocity("y"); } catch { /* InertiaPlugin missing */ }
        const direction = commitOf(this.x, this.y, vx, vy);
        if (direction) { this.disable(); void fly(direction); return; }
        gsap.to(el, { x: 0, y: 0, rotation: 0, rotationX: 0, duration: 0.62, ease: "elastic.out(1, 0.62)", onUpdate: () => paint(stage, Number(gsap.getProperty(el, "x")), Number(gsap.getProperty(el, "y"))) });
      },
    });
    return () => { invite.current?.kill(); drag.kill(); };
  }, { dependencies: [card.id], revertOnUpdate: true });

  return <div ref={deck} className={`onb-deck${hinting ? " is-hinting" : ""}`} data-sector={sector} style={{ "--force": 0 } as CSSProperties} aria-busy={exiting}>
    <button type="button" className="onb-vote" data-dir="no" disabled={exiting} onClick={() => void fly("no")}>I don’t see it</button>
    <div className="onb-deck-stage">
      <i className="onb-well is-no" aria-hidden="true" />
      <i className="onb-well is-yes" aria-hidden="true" />
      <i className="onb-well is-unsure" aria-hidden="true" />
      {Array.from({ length: Math.min(2, backs) }, (_, i) => {
        const rise = i + 1;
        return <div key={`back-${i}`} className="onb-card-swipe is-back" data-sector={sector} aria-hidden="true" data-depth={i + 1}
          style={{ transform: `translateY(${rise * 14}px) scale(${1 - rise * .045})`, opacity: 1 - rise * .28 }} />;
      })}
      <div ref={top} className="onb-card-swipe" data-sector={sector} data-depth="0" tabIndex={0} role="group"
        aria-label={`${card.text} Swipe left to disagree, right to agree, down for unsure.`}
        onKeyDown={e => { const d = ({ ArrowLeft: "no", ArrowRight: "yes", ArrowDown: "unsure" } as const)[e.key as "ArrowLeft"]; if (d) { e.preventDefault(); void fly(d); } }}>
        <span className="onb-swipe-handle" aria-hidden="true" />
        <Icon className="onb-swipe-mark" strokeWidth={1} aria-hidden="true" />
        <span className="onb-swipe-topic"><Icon size={18} strokeWidth={1.6} aria-hidden="true" />{card.category}</span>
        <h2>{card.text}</h2>
        {card.lead ? <p className="onb-swipe-lead">{card.lead}</p> : null}
        <span className="onb-stamp is-yes" aria-hidden="true">I see it</span>
        <span className="onb-stamp is-no" aria-hidden="true">I don’t</span>
        <span className="onb-stamp is-unsure" aria-hidden="true">Not sure</span>
      </div>
    </div>
    <button type="button" className="onb-vote" data-dir="yes" disabled={exiting} onClick={() => void fly("yes")}>I see it</button>
    <button type="button" className="onb-vote is-unsure" data-dir="unsure" disabled={exiting} onClick={() => void fly("unsure")}>Not sure</button>
    {(total !== undefined || onUndo) && <div className="onb-deck-foot">
      {total !== undefined && <div className="onb-dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < (answered ?? 0) ? "active" : i === (answered ?? 0) ? "is-now" : ""} />)}</div>}
      {onUndo && <button type="button" className="onb-text-button" onClick={onUndo}><RotateCcw size={13} aria-hidden="true" /> Undo last swipe</button>}
    </div>}
  </div>;
}

export function DealingDeck({ backs = 1, answered, total }: { backs?: number; answered?: number; total?: number }) {
  return <div className="onb-deck is-dealing" role="status" aria-live="polite" aria-label="Loading">
    <div className="onb-deck-stage">
      {Array.from({ length: Math.min(2, backs) }, (_, i) => {
        const rise = i + 1;
        return <div key={`back-${i}`} className="onb-card-swipe is-back" aria-hidden="true" data-depth={i + 1}
          style={{ transform: `translateY(${rise * 14}px) scale(${1 - rise * .045})`, opacity: 1 - rise * .28 }} />;
      })}
      <div className="onb-card-swipe is-face-down" data-depth="0" aria-hidden="true" />
    </div>
    {total !== undefined && <div className="onb-deck-foot"><div className="onb-dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < (answered ?? 0) ? "active" : i === (answered ?? 0) ? "is-now" : ""} />)}</div></div>}
  </div>;
}

/** Overlay generated swipe copy onto a card whose id and category already
 * belong on the tree. The whole seven-domain pack is written once, from
 * knowledge — a swipe never changes the next swipe. Cached per knowledge so
 * an undo does not spend another generation. */
export function InferredSwipeDeck({ upcoming, knowledge, confidence, fetchDeck = fetchPredictionDeck, ...deck }: {
  upcoming: DeckCard;
  knowledge: number | null;
  confidence: number | null;
  fetchDeck?: DeckFetcher;
  backs?: number; answered?: number; total?: number;
  onVote: (direction: Direction, card: DeckCard) => Promise<void> | void;
  onUndo?: () => void;
}) {
  const [pack, setPack] = useState<Map<string, DeckCard> | null>(null);
  const cache = useRef(new Map<number, Map<string, DeckCard>>());
  const fetchRef = useRef(fetchDeck);
  fetchRef.current = fetchDeck;
  const key = knowledge ?? -1;

  useEffect(() => {
    const cached = cache.current.get(key);
    if (cached) { setPack(cached); return; }
    let cancelled = false;
    const controller = new AbortController();
    setPack(null);
    fetchRef.current({ knowledge, confidence }, controller.signal).then(cards => {
      if (cancelled) return;
      const next = new Map(cards.map(card => [card.category, { id: card.id, category: card.category, text: card.title } as DeckCard]));
      cache.current.set(key, next);
      setPack(next);
    }).catch(() => {
      if (cancelled) return;
      const fallback = new Map(predictions(knowledge ?? 0).map(card => [card.category, { id: card.id, category: card.category, text: card.text }]));
      cache.current.set(key, fallback);
      setPack(fallback);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [key, knowledge, confidence]);

  if (!pack) return <DealingDeck backs={deck.backs} answered={deck.answered} total={deck.total} />;
  const live = pack.get(upcoming.category) ?? upcoming;
  const card: DeckCard = { id: upcoming.id, category: upcoming.category, text: live.text };
  return <PredictionDeck {...deck} card={card} onVote={direction => deck.onVote(direction, card)} />;
}
