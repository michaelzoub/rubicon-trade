"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { PersonStanding } from "lucide-react";
import { CONFIDENCE, CONFIDENCE_NOTES, CONFIDENCE_STOPS, EXPERIENCE } from "@/lib/socialtrading/onboarding";
import { prefersReducedMotion } from "../_components/motion";

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

interface FoundationScaleProps {
  kind: "clarity" | "knowledge";
  value: number | null;
  onChange: (value: number) => void;
}

interface ConfidenceJourneyProps {
  value: number | null;
  onChange: (value: number) => void;
}

export function signalClarity(position: number) {
  return clamp(position);
}

/** Four stops on a rail that starts and ends on a choice, so Exploring and
 * Strong convictions sit on the furthest reachable points. */
export const stopAt = (position: number) => Math.round(clamp(position) * 3);
export const stopCenter = (value: number) => clamp(Math.min(3, value) / 3);

/** How much of the trace is a real wave. Exploring stays almost all static. */
export function signalMix(clarity: number) {
  return Math.pow(clamp(clarity), 1.55);
}

export function noiseAmount(clarity: number) {
  return 1 - signalMix(clarity);
}

/** Cycles per pixel. Static is fast; a found signal settles to a slower tone. */
export function waveFrequency(clarity: number) {
  return .05 - signalMix(clarity) * .034;
}

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function sampleWave(x: number, t: number, clarity: number) {
  const mix = signalMix(clarity);
  const signal = Math.sin(x * waveFrequency(clarity) + t * (1.35 + mix * .5));
  const snow = (hash(x * .85 + Math.floor(t * 46) * .19) - .5) * 2;
  const spike = hash(x * 2.2 + Math.floor(t * 30)) > .86 ? (hash(x + t * 3) - .5) * 2.8 : 0;
  const grain = (hash(x * 7.4 + Math.floor(t * 16) * .23) - .5) * .18
    + (hash(x * 15.1 + Math.floor(t * 21) * .17) - .5) * .08;
  return snow * (1 - mix) + spike * (1 - mix) * .4 + (signal + grain) * mix;
}

function drawWaveform(canvas: HTMLCanvasElement, time: number, clarity: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const mid = height * .5, amp = height * .28;
  const mix = signalMix(clarity);
  const snow = Math.round(width * height * .00055 * (1 - mix));
  ctx.fillStyle = `rgba(255, 255, 255, ${.1 + (1 - mix) * .22})`;
  for (let i = 0; i < snow; i++) {
    ctx.fillRect(hash(i * 13.7 + Math.floor(time * 38)) * width, hash(i * 29.1 + Math.floor(time * 38) + 4) * height, 1.15, 1.15);
  }
  ctx.beginPath();
  let drawing = false;
  const step = 1.4 - mix * .7;
  for (let x = 0; x <= width; x += step) {
    const hold = mix < .18 && hash(x * .6 + Math.floor(time * 40)) > .28 + mix;
    const y = mid + sampleWave(x, time, clarity) * amp;
    if (hold) { drawing = false; continue; }
    if (!drawing) { ctx.moveTo(x, y); drawing = true; }
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(245, 247, 250, ${.35 + mix * .6})`;
  ctx.lineWidth = 1.35 + mix * .45;
  ctx.shadowBlur = 4 + mix * 10;
  ctx.shadowColor = `rgba(255, 255, 255, ${.12 + mix * .28})`;
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function tickHaptic(stop: number) {
  if (typeof navigator === "undefined" || !navigator.vibrate) return;
  navigator.vibrate(5 + (3 - stop) * 5);
}

/** A screen you tune: static falls away as a white wave comes into frequency. */
function ConfidenceJourney({ value, onChange }: ConfidenceJourneyProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clarityRef = useRef(0);
  const lastStop = useRef(value ?? 0);
  const [position, setPosition] = useState(value === null ? 0 : stopCenter(Math.min(3, value)));
  const selected = value === null ? 0 : stopAt(position);
  const clarity = signalClarity(position);
  const spoken = `${CONFIDENCE[selected]}. ${CONFIDENCE_NOTES[selected]}`;
  clarityRef.current = clarity;

  useEffect(() => {
    if (value === null) onChange(0);
  }, [value, onChange]);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let frame = 0;
    const reduced = prefersReducedMotion();
    const tick = (now: number) => {
      drawWaveform(node, now / 1000, clarityRef.current);
      if (!reduced) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => drawWaveform(node, performance.now() / 1000, clarityRef.current));
    observer?.observe(node);
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, []);

  function live(next: number) {
    setPosition(next);
    const stop = stopAt(next);
    if (stop !== lastStop.current) {
      lastStop.current = stop;
      tickHaptic(stop);
    }
    if (value !== stop) onChange(stop);
  }
  function commit(next: number) {
    const stop = stopAt(next);
    setPosition(stopCenter(stop));
    lastStop.current = stop;
    if (value !== stop) onChange(stop);
  }
  function pick(index: number) {
    setPosition(stopCenter(index));
    lastStop.current = index;
    tickHaptic(index);
    if (value !== index) onChange(index);
  }

  const axis = { min: 0, max: 1, value: position, onChange: live, onCommit: commit };
  const well = useDrag<HTMLDivElement>(axis, null, { pad: 18, placeOnPress: true });
  const { dragging: tuning, ...wellHandlers } = well;

  return <div className="onb-signal" style={{ "--clarity": clarity } as CSSProperties}>
    <div className="onb-signal-well" data-dragging={tuning || undefined} tabIndex={0} aria-label="Drag the signal to set how clear your views are" {...wellHandlers}>
      <div className="onb-signal-graticule" aria-hidden="true" />
      <canvas ref={canvas} className="onb-signal-wave" aria-hidden="true" />
    </div>
    <div className="onb-signal-control">
      <div className="onb-signal-copy">
        <strong>{CONFIDENCE[selected]}</strong>
        <p>{CONFIDENCE_NOTES[selected]}</p>
      </div>
      <div className="onb-signal-stops">
        <i className="onb-signal-thumb" aria-hidden="true" />
        {CONFIDENCE_STOPS.map((label, index) => <button key={label} type="button" aria-pressed={selected === index}
          onClick={() => pick(index)}>{label}</button>)}
        <SmoothRange className="onb-pad-range" label="How clear your views about the future are" value={position} valueText={spoken}
          onChange={live} onCommit={commit} />
      </div>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{spoken}</p>
  </div>;
}

/** The first foundation is a signal you tune; the second remains a trail. */
export function FoundationScale(props: FoundationScaleProps) {
  if (props.kind === "clarity") return <ConfidenceJourney value={props.value} onChange={props.onChange} />;
  return <KnowledgeScale value={props.value} onChange={props.onChange} />;
}

function KnowledgeScale({ value, onChange }: Omit<FoundationScaleProps, "kind">) {
  const [position, setPosition] = useState(value === null ? 0 : intervalCenter(Math.min(3, value)));
  const labels = EXPERIENCE;
  const selected = value === null ? null : intervalAt(position);
  const current = selected === null ? "Drag to find your starting point" : labels[selected];
  function change(next: number) { setPosition(next); const interval = intervalAt(next); if (value !== interval) onChange(interval); }
  const scene = useDrag<HTMLDivElement>({ min: 0, max: 1, value: position, onChange: change }, null, { pad: 24 });
  const { dragging, ...sceneHandlers } = scene;
  const trailY = (p: number) => 96 - 38 * Math.sin(p * 4 * Math.PI);
  return <div className="onb-scale is-knowledge" data-set={selected === null ? undefined : ""}>
    <div className="onb-scene" data-dragging={dragging || undefined} {...sceneHandlers} aria-hidden="true">
      <svg viewBox="0 0 800 160" preserveAspectRatio="none">
        <path className="onb-trail-path" d="M40 96 Q135 20 230 96 T420 96 T610 96 T800 96" />
        {[.125, .375, .625, .875].map(p => <circle key={p} className={`onb-trail-stop${selected !== null && intervalAt(p) <= selected ? " is-passed" : ""}`} cx={40 + p * 760} cy={trailY(p)} r="4" />)}
      </svg>
      <div className="onb-traveler" style={{ left: `${7 + position * 86}%`, top: `${trailY(position) / 160 * 100}%` }}><PersonStanding size={26} strokeWidth={1.6} /></div>
      <span className="onb-scene-readout" aria-hidden="true">{current}</span>
    </div>
    <div className="onb-track">
      <SmoothRange label="Investment knowledge" value={position} valueText={current} onChange={change} />
      <div className="onb-stops">{labels.map((label, i) => <button key={label} type="button" aria-pressed={selected === i} onClick={() => { setPosition(intervalCenter(i)); onChange(i); }}><i aria-hidden="true" /><span>{label}</span></button>)}</div>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{current}</p>
  </div>;
}
