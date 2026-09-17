"use client";

import { useCallback, useRef, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";

const CAPTURE = 1.65;  // Capture radius, as a multiple of the hole's own radius.
const MAGNET = .6;     // How much of the remaining distance the hole takes for itself.

type Point = { x: number; y: number };
type Live = { label: string; from: Point; to: Point; pull: number; held: boolean };

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const centreOf = (el: Element, host: DOMRect) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top }; };

/** Where each theme floats: a ring around the mouth, spaced by hand so no two
 * chips collide and none touches an edge. A chip keeps its place as its
 * neighbours are swallowed, so the field never reshuffles under the cursor. */
const SLOTS: [number, number][] = [[22, 11], [50, 7], [78, 12], [16, 32], [84, 31], [14, 54], [86, 53], [18, 76], [82, 75], [36, 90], [64, 90]];
function slot(index: number) {
  const [x, y] = SLOTS[index % SLOTS.length];
  return { left: `${x}%`, top: `${y}%`, "--drift": `${(index % 5) * 1.3 + 7}s`, "--delay": `${index * -.9}s` } as CSSProperties;
}

/** Point at a theme and a line is drawn to the hole: that line is the whole
 * instruction. Follow it by dragging and the mouth pulls the chip the last of
 * the way in; skip the drag and a tap sends it along the same arc. */
export function DislikeVoid({ values, released, openToEverything, onRelease, onRestore, onToggleOpen }: {
  values: string[]; released: string[]; openToEverything: boolean;
  onRelease: (value: string) => void; onRestore: (value: string) => void; onToggleOpen: () => void;
}) {
  const field = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [wave, setWave] = useState(0);
  const floating = values.filter(v => !released.includes(v));

  /** The mouth's centre and capture radius, in field coordinates. */
  const mouth = useCallback(() => {
    const host = field.current?.getBoundingClientRect(), disc = hole.current;
    if (!host || !disc) return null;
    const r = disc.getBoundingClientRect();
    return { host, centre: { x: r.left + r.width / 2 - host.left, y: r.top + r.height / 2 - host.top }, radius: r.width / 2 * CAPTURE };
  }, []);

  /** Where a chip sits before it is moved, so a drag never measures its own pull. */
  const grab = useCallback((el: HTMLElement) => {
    const host = field.current?.getBoundingClientRect();
    return host ? centreOf(el, host) : { x: 0, y: 0 };
  }, []);

  /** One arc into the mouth, for a drag and for a tap alike. */
  const swallow = useCallback(async (el: HTMLElement, base: Point, offset: Point, label: string) => {
    const to = mouth();
    setWave(n => n + 1);
    if (to && el.animate && !reduced()) {
      const dx = to.centre.x - base.x, dy = to.centre.y - base.y;
      const spin = el.animate([
        { transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(1) rotate(0deg)`, opacity: 1 },
        { transform: `translate3d(${(offset.x + dx) * .58}px, ${(offset.y + dy) * .58}px, 0) scale(.48) rotate(170deg)`, opacity: .8, offset: .55 },
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(0) rotate(340deg)`, opacity: 0 },
      ], { duration: 440, easing: "cubic-bezier(.55, 0, .85, .2)", fill: "forwards" });
      try { await spin.finished; } catch { /* unmounted mid-flight; the release still stands */ }
    }
    onRelease(label);
  }, [mouth, onRelease]);

  /** The line a chip would travel along, drawn the moment it is pointed at. */
  const aim = useCallback((label: string, at: Point, held: boolean) => {
    const to = mouth();
    if (!to) return { x: 0, y: 0 };
    const d = Math.hypot(to.centre.x - at.x, to.centre.y - at.y);
    const pull = !held || d > to.radius ? 0 : (1 - d / to.radius) ** 1.4;
    setLive({ label, from: at, to: to.centre, pull, held });
    return { x: (to.centre.x - at.x) * pull * MAGNET, y: (to.centre.y - at.y) * pull * MAGNET };
  }, [mouth]);

  return <div className="onb-void" data-live={live ? "" : undefined} data-held={live?.held ? "" : undefined} style={{ "--pull": live?.pull ?? 0 } as CSSProperties}>
    <div className="onb-void-field" ref={field}>
      <svg className="onb-void-line" aria-hidden="true">
        {live && <line x1={live.from.x} y1={live.from.y} x2={live.to.x} y2={live.to.y} style={{ opacity: live.held ? .55 + live.pull * .45 : .45 }} />}
      </svg>

      <div className="onb-void-chips">
        {floating.map(value => <VoidChip key={value} label={value} style={slot(values.indexOf(value))} onGrab={grab}
          onAim={el => { aim(value, grab(el), false); }}
          onLeave={() => setLive(current => current?.label === value && !current.held ? null : current)}
          onFrame={(base, delta) => aim(value, { x: base.x + delta.x, y: base.y + delta.y }, true)}
          onDrop={(el, base, offset) => {
            const captured = (live?.label === value ? live.pull : 0) > .2;
            setLive(null);
            if (captured) void swallow(el, base, offset, value);
            return captured;
          }}
          onTap={el => void swallow(el, grab(el), { x: 0, y: 0 }, value)} />)}
      </div>

      <div className="onb-void-hole" aria-hidden="true">
        <span className="onb-void-disc" ref={hole} />
        <span className="onb-void-ring" />
        <span className="onb-void-ring is-outer" />
        {wave > 0 && <span className="onb-void-wave" key={wave} />}
        <span className="onb-void-mouth mono">LET IT GO</span>
      </div>
    </div>

    <p className="sr-only" role="status" aria-live="polite">{released.length ? `${released.length} released: ${released.join(", ")}` : "Nothing released yet."}</p>
    <div className="onb-void-foot">
      <button type="button" className="onb-void-keep" aria-pressed={openToEverything} onClick={onToggleOpen}>I’m open to everything</button>
      {released.length > 0 && <div className="onb-void-back">{released.map(value => <button type="button" key={value} onClick={() => onRestore(value)}>{value}<RotateCcw size={11} aria-hidden="true" /></button>)}</div>}
    </div>
  </div>;
}

/** Each chip owns its pointer, so a drag never leaks into another chip's click.
 * The field decides how hard the hole is pulling; the chip only carries it. */
function VoidChip({ label, style, onGrab, onAim, onLeave, onFrame, onDrop, onTap }: {
  label: string; style: CSSProperties;
  onGrab: (el: HTMLElement) => Point;
  onAim: (el: HTMLElement) => void;
  onLeave: () => void;
  onFrame: (base: Point, delta: Point) => Point;
  onDrop: (el: HTMLElement, base: Point, offset: Point) => boolean;
  onTap: (el: HTMLElement) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number; magnet: Point } | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; base: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const offset = drag ? { x: drag.x + drag.magnet.x, y: drag.y + drag.magnet.y } : { x: 0, y: 0 };
  return <button type="button" className="onb-void-chip" data-dragging={drag ? "" : undefined} aria-label={`Let go of ${label}`}
    style={{ ...style, ...(drag ? { transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` } : {}) }}
    onPointerEnter={event => { if (!drag) onAim(event.currentTarget); }}
    onFocus={event => onAim(event.currentTarget)}
    onPointerLeave={() => { if (!gesture.current) onLeave(); }}
    onBlur={() => { if (!gesture.current) onLeave(); }}
    onClick={event => { if (suppressClick.current) { event.preventDefault(); suppressClick.current = false; return; } onTap(event.currentTarget); }}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base: onGrab(event.currentTarget), moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ x: 0, y: 0, magnet: { x: 0, y: 0 } });
    }}
    onPointerMove={event => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      const x = event.clientX - g.x, y = event.clientY - g.y;
      if (Math.hypot(x, y) > 4) g.moved = true;
      setDrag({ x, y, magnet: onFrame(g.base, { x, y }) });
    }}
    onPointerUp={event => {
      const g = gesture.current;
      if (!g || g.id !== event.pointerId) return;
      gesture.current = null;
      suppressClick.current = g.moved;
      if (!onDrop(event.currentTarget, g.base, offset)) setDrag(null);
    }}
    onPointerCancel={() => { gesture.current = null; suppressClick.current = true; setDrag(null); onLeave(); }}
    onLostPointerCapture={() => { if (gesture.current) { gesture.current = null; suppressClick.current = true; setDrag(null); onLeave(); } }}
  >{label}</button>;
}
