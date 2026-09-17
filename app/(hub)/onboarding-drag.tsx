"use client";

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PersonStanding } from "lucide-react";
import { CONFIDENCE, EXPERIENCE } from "@/lib/socialtrading/onboarding";

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const intervalAt = (position: number) => Math.min(3, Math.floor(clamp(position) * 4));
export const intervalCenter = (value: number) => (value + .5) / 4;

export type DragAxis = {
  min: number; max: number; value: number;
  onChange: (value: number) => void; onCommit?: (value: number) => void;
  /** Screen-up increases the value (charts); by default screen-right does. */
  invert?: boolean;
};
type DragOptions = {
  /** The first press places the value under the pointer instead of moving relative to it. */
  placeOnPress?: boolean;
  /** Fraction of the element's box that maps onto the axis. Defaults to the full box. */
  spanX?: [number, number]; spanY?: [number, number];
  /** Pixels of the box reserved for a thumb, so the extremes stay reachable. */
  pad?: number;
};
type Gesture = { id: number; px: number; py: number; w: number; h: number; sx: number; sy: number; lx: number; ly: number };

/** The value at a fraction of an axis's span. An inverted axis grows toward screen-up, so fraction 0 (the top) is its maximum. */
export function valueAt(axis: Pick<DragAxis, "min" | "max" | "invert">, fraction: number) {
  const f = clamp(axis.invert ? 1 - fraction : fraction);
  return axis.min + f * (axis.max - axis.min);
}

/** One gesture model for every drag in onboarding. Motion is relative to the
 * grab point, so pressing never jumps a value, and values stay continuous:
 * nothing snaps mid-drag. Whoever renders derives the state a value falls in. */
export function useDrag<T extends Element>(x: DragAxis | null, y: DragAxis | null = null, options: DragOptions = {}) {
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const spanX = options.spanX ?? [0, 1], spanY = options.spanY ?? [0, 1], pad = options.pad ?? 0;
  function move(event: ReactPointerEvent<T>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    if (x) { g.lx = clamp(g.sx + (event.clientX - g.px) / g.w * (x.max - x.min) * (x.invert ? -1 : 1), x.min, x.max); x.onChange(g.lx); }
    if (y) { g.ly = clamp(g.sy + (event.clientY - g.py) / g.h * (y.max - y.min) * (y.invert ? -1 : 1), y.min, y.max); y.onChange(g.ly); }
  }
  function end(commit: boolean) {
    const g = gesture.current;
    gesture.current = null; setDragging(false);
    if (!g) return;
    if (commit) { x?.onCommit?.(g.lx); y?.onCommit?.(g.ly); }
    else { if (x) { x.onChange(g.sx); x.onCommit?.(g.sx); } if (y) { y.onChange(g.sy); y.onCommit?.(g.sy); } }
  }
  return {
    dragging,
    onPointerDown(event: ReactPointerEvent<T>) {
      if (event.button !== 0 || gesture.current) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const left = rect.left + spanX[0] * rect.width + pad, w = Math.max(1, (spanX[1] - spanX[0]) * rect.width - 2 * pad);
      const top = rect.top + spanY[0] * rect.height + pad, h = Math.max(1, (spanY[1] - spanY[0]) * rect.height - 2 * pad);
      const sx = x ? options.placeOnPress ? valueAt(x, (event.clientX - left) / w) : x.value : 0;
      const sy = y ? options.placeOnPress ? valueAt(y, (event.clientY - top) / h) : y.value : 0;
      gesture.current = { id: event.pointerId, px: event.clientX, py: event.clientY, w, h, sx, sy, lx: sx, ly: sy };
      if (options.placeOnPress) { x?.onChange(sx); y?.onChange(sy); }
      (event.currentTarget as unknown as HTMLElement).focus?.({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    },
    onPointerMove: move,
    onPointerUp(event: ReactPointerEvent<T>) {
      if (!gesture.current || gesture.current.id !== event.pointerId) return;
      move(event); end(true);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    },
    onPointerCancel() { end(false); },
    onLostPointerCapture() { gesture.current = null; setDragging(false); },
  };
}

/** A native range for keyboard and assistive input that owns its pointer gesture. */
export function SmoothRange({ value, min = 0, max = 1, label, valueText, onChange, onCommit, className = "" }: {
  value: number; min?: number; max?: number; label: string; valueText: string;
  onChange: (value: number) => void; onCommit?: (value: number) => void; className?: string;
}) {
  const drag = useDrag<HTMLInputElement>({ min, max, value, onChange, onCommit }, null, { pad: 11 });
  const { dragging, ...handlers } = drag;
  return <input className={`onb-range ${className}`} data-dragging={dragging || undefined} type="range" min={min} max={max} step="any" value={value}
    aria-label={label} aria-valuetext={valueText} style={{ "--range-position": `${(value - min) / (max - min) * 100}%` } as CSSProperties}
    {...handlers}
    onClick={event => event.preventDefault()}
    onChange={event => { if (!dragging) { const next = Number(event.target.value); onChange(next); onCommit?.(next); } }} />;
}

/** Continuous position on a four-stop scale. The traveler follows the pointer
 * exactly; the stop it falls in is what gets highlighted and saved. The four
 * stops sit on the track itself, so tapping and dragging are the same control. */
export function FoundationScale({ kind, value, onChange }: { kind: "clarity" | "knowledge"; value: number | null; onChange: (value: number) => void }) {
  const [position, setPosition] = useState(value === null ? 0 : intervalCenter(Math.min(3, value)));
  const labels = kind === "clarity" ? CONFIDENCE : EXPERIENCE;
  const selected = value === null ? null : intervalAt(position);
  const current = selected === null ? (kind === "clarity" ? "Drag to find your focus" : "Drag to find your starting point") : labels[selected];
  function change(next: number) { setPosition(next); const interval = intervalAt(next); if (value !== interval) onChange(interval); }
  const scene = useDrag<HTMLDivElement>({ min: 0, max: 1, value: position, onChange: change }, null, { pad: 24 });
  const { dragging, ...sceneHandlers } = scene;
  const trailY = (p: number) => 96 - 38 * Math.sin(p * 4 * Math.PI);
  return <div className={`onb-scale is-${kind}`} data-set={selected === null ? undefined : ""}>
    <div className="onb-scene" data-dragging={dragging || undefined} style={{ "--position": position, "--clarity": position * 3 } as CSSProperties} {...sceneHandlers} aria-hidden="true">
      {kind === "clarity" ? <>
        <div className="onb-focus-field">
          <span className="onb-focus-line" style={{ "--i": 0 } as CSSProperties}>Some of the future is still a blur.</span>
          <span className="onb-focus-line" style={{ "--i": 1 } as CSSProperties}>Some of it is already sharp.</span>
          <span className="onb-focus-line" style={{ "--i": 2 } as CSSProperties}>Drag the lens to where you stand.</span>
        </div>
        <div className="onb-lens"><span /></div>
      </> : <>
        <svg viewBox="0 0 800 160" preserveAspectRatio="none">
          <path className="onb-trail-path" d="M40 96 Q135 20 230 96 T420 96 T610 96 T800 96" />
          {[.125, .375, .625, .875].map(p => <circle key={p} className={`onb-trail-stop${selected !== null && intervalAt(p) <= selected ? " is-passed" : ""}`} cx={40 + p * 760} cy={trailY(p)} r="4" />)}
        </svg>
        <div className="onb-traveler" style={{ left: `${7 + position * 86}%`, top: `${trailY(position) / 160 * 100}%` }}><PersonStanding size={26} strokeWidth={1.6} /></div>
      </>}
      <span className="onb-scene-readout" aria-hidden="true">{current}</span>
    </div>
    <div className="onb-track">
      <SmoothRange label={kind === "clarity" ? "Clarity of your beliefs" : "Investment knowledge"} value={position} valueText={current} onChange={change} />
      <div className="onb-stops">{labels.map((label, i) => <button key={label} type="button" aria-pressed={selected === i} onClick={() => { setPosition(intervalCenter(i)); onChange(i); }}><i aria-hidden="true" /><span>{label}</span></button>)}</div>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{current}</p>
  </div>;
}
