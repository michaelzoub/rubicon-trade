"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, Bot, BriefcaseBusiness, ChevronLeft, ChevronRight, Coins, Globe2, HeartPulse, RotateCcw, Sprout, Zap } from "lucide-react";
import { CATEGORIES } from "@/lib/socialtrading/onboarding";

/** Positional with CATEGORIES, so a domain looks the same wherever it appears. */
export const CATEGORY_ICONS = [Bot, Zap, Coins, HeartPulse, Globe2, Sprout, BriefcaseBusiness];
export const iconFor = (category: string) => CATEGORY_ICONS[Math.max(0, CATEGORIES.indexOf(category))];

const THROW = 68;   // Pixels of travel that commit a swipe.

export type Direction = "yes" | "no" | "unsure";
export type DeckCard = { id: string; category: string; text: string };

/** A deck you throw rather than a form you fill. The top card follows the
 * pointer one-to-one, tilts into the throw and stamps the answer on itself as
 * it goes. What sits behind it is drawn blank on purpose: the next question is
 * chosen from this answer, so it does not exist yet. */
export function PredictionDeck({ card, backs = 0, answered, total, onVote, onUndo }: {
  card: DeckCard; backs?: number;
  /** Given together, they draw the run's progress under the deck. */
  answered?: number; total?: number;
  onVote: (direction: Direction) => Promise<void> | void; onUndo?: () => void;
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [exiting, setExiting] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef(false);
  const flight = useRef<Animation | null>(null);
  useEffect(() => () => { flight.current?.cancel(); }, []);

  // Which way the throw is leaning right now, and how committed it looks.
  const down = drag.y > Math.abs(drag.x);
  const lean: Direction | null = down ? (drag.y > 12 ? "unsure" : null) : Math.abs(drag.x) > 12 ? (drag.x > 0 ? "yes" : "no") : null;
  const force = Math.min(1, (down ? drag.y : Math.abs(drag.x)) / THROW);
  const Icon = iconFor(card.category);

  async function commit(direction: Direction) {
    if (locked.current) return;
    locked.current = true; setExiting(true); pointer.current = null;
    const el = top.current;
    if (el?.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const x = direction === "yes" ? 720 : direction === "no" ? -720 : drag.x;
      const y = direction === "unsure" ? 520 : drag.y;
      flight.current = el.animate(
        [{ transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 26}deg)`, opacity: 1 }, { transform: `translate(${x}px, ${y}px) rotate(${x / 26}deg)`, opacity: 0 }],
        { duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
      // A throw that never reports back (a backgrounded tab, a cancelled
      // animation) must not leave the deck locked with a card mid-air.
      const landed = await Promise.race([flight.current.finished.then(() => true).catch(() => false), new Promise<boolean>(resolve => setTimeout(() => resolve(true), 600))]);
      flight.current.cancel();
      if (!landed) { locked.current = false; setExiting(false); return; }
    }
    setDrag({ x: 0, y: 0 }); locked.current = false; setExiting(false);
    await onVote(direction);
  }

  return <div className="onb-deck" data-lean={lean ?? undefined} style={{ "--force": force } as CSSProperties}>
    <div className="onb-deck-stage">
      <span className="onb-deck-rail is-left" aria-hidden="true"><ChevronLeft size={18} /></span>
      <span className="onb-deck-rail is-right" aria-hidden="true"><ChevronRight size={18} /></span>
      {Array.from({ length: Math.min(2, backs) }, (_, i) => {
        // The backs rise as the top card is thrown clear of them.
        const rise = i + 1 - force * .6;
        return <div key={`back-${i}`} className="onb-card-swipe is-back" aria-hidden="true" data-depth={i + 1}
          style={{ transform: `translateY(${rise * 20}px) scale(${1 - rise * .06})`, opacity: 1 - rise * .3 }} />;
      })}
      <div ref={top} className="onb-card-swipe" data-depth="0" tabIndex={0} role="group"
        aria-label="Prediction. Left to disagree, right to agree, down for unsure."
        style={{ transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 26}deg)` }}
        onKeyDown={e => { const d = ({ ArrowLeft: "no", ArrowRight: "yes", ArrowDown: "unsure" } as const)[e.key as "ArrowLeft"]; if (d) { e.preventDefault(); void commit(d); } }}
        onPointerDown={e => { if (e.button !== 0 || locked.current) return; flight.current?.cancel(); pointer.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (pointer.current) setDrag({ x: e.clientX - pointer.current.x, y: e.clientY - pointer.current.y }); }}
        onPointerCancel={() => { pointer.current = null; setDrag({ x: 0, y: 0 }); }}
        onLostPointerCapture={() => { pointer.current = null; }}
        onPointerUp={e => {
          if (!pointer.current) return;
          const x = e.clientX - pointer.current.x, y = e.clientY - pointer.current.y;
          pointer.current = null;
          if (y > THROW && y > Math.abs(x)) void commit("unsure");
          else if (Math.abs(x) > THROW) void commit(x > 0 ? "yes" : "no");
          else {
            if (top.current?.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches)
              flight.current = top.current.animate([{ transform: `translate(${x}px, ${y}px) rotate(${x / 26}deg)` }, { transform: "translate(0px, 0px) rotate(0deg)" }], { duration: 420, easing: "cubic-bezier(.16, 1.4, .3, 1)" });
            setDrag({ x: 0, y: 0 });
          }
        }}>
        <span className="onb-swipe-topic"><Icon size={22} strokeWidth={1.4} aria-hidden="true" />{card.category}</span>
        <h2>{card.text}</h2>
        <span className="onb-stamp is-yes" aria-hidden="true">I see it</span>
        <span className="onb-stamp is-no" aria-hidden="true">I don’t</span>
        <span className="onb-stamp is-unsure" aria-hidden="true">Not sure</span>
      </div>
    </div>

    <div className="onb-votes" aria-busy={exiting}>
      <button type="button" disabled={exiting} onClick={() => void commit("no")}><ArrowLeft /><span>I don’t see it</span></button>
      <button type="button" disabled={exiting} onClick={() => void commit("unsure")}><ArrowDown /><span>Not sure</span></button>
      <button type="button" className="is-yes" disabled={exiting} onClick={() => void commit("yes")}><ArrowRight /><span>I see it</span></button>
    </div>

    {(total !== undefined || onUndo) && <div className="onb-deck-foot">
      {total !== undefined && <div className="onb-dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i <= (answered ?? 0) ? "active" : ""} />)}</div>}
      {onUndo && <button type="button" className="onb-text-button" onClick={onUndo}><RotateCcw size={13} aria-hidden="true" /> Undo last swipe</button>}
    </div>}
  </div>;
}
