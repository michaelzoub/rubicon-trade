"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { gsap, useGSAP, prefersReducedMotion } from "../../_components/motion";

export type TracePoint = { time: number; price: number };

/** Where the pointer rests on a trace: which point, and where it is drawn. */
export type TraceHit = { index: number; x: number; y: number; width: number; height: number };

/**
 * A price over time as one smooth line over a soft fill, drawn at real pixel
 * size so the stroke never distorts. It is the same drawing on a card and on
 * the instrument page; only the size and the chrome around it change.
 *
 * Reaching across it reveals a hairline and a point that glide to the nearest
 * reading. What the reading says is the caller's to render, positioned from
 * the hit this reports, so the trace itself never carries typography.
 */
export function PriceTrace({ points, height, className = "", pad = { top: 8, bottom: 2 }, onScrub, scrub = true, label, tone = "blue" }: {
  points: TracePoint[];
  height: number;
  className?: string;
  /** Breathing room above the peak and below the trough, in pixels. */
  pad?: { top: number; bottom: number };
  onScrub?: (hit: TraceHit | null) => void;
  scrub?: boolean;
  label?: string;
  /** Blue is the product's own light. Up and down are said by the pill, not the line. */
  tone?: "blue" | "up" | "down";
}) {
  const id = useId().replace(/:/g, "");
  const frame = useRef<HTMLDivElement>(null);
  const cursor = useRef<SVGGElement>(null);
  const dot = useRef<SVGGElement>(null);
  const [width, setWidth] = useState(0);
  const moveX = useRef<((v: number) => void) | null>(null);
  const moveDotX = useRef<((v: number) => void) | null>(null);
  const moveDotY = useRef<((v: number) => void) | null>(null);
  const active = useRef<number | null>(null);

  // The drawing follows its box, whatever the box does.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth || node.getBoundingClientRect().width || 0);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // The drawing only exists once its box has been measured, so the movers are
  // made the first time they are needed, against the elements that are there.
  const movers = useRef<{ for: Element | null }>({ for: null });
  const arm = () => {
    if (!cursor.current || !dot.current) return false;
    if (movers.current.for === cursor.current) return true;
    const ease = "power3.out", duration = prefersReducedMotion() ? 0 : .22;
    gsap.set([cursor.current, dot.current], { autoAlpha: 0 });
    moveX.current = gsap.quickTo(cursor.current, "x", { duration, ease });
    moveDotX.current = gsap.quickTo(dot.current, "x", { duration, ease });
    moveDotY.current = gsap.quickTo(dot.current, "y", { duration, ease });
    movers.current.for = cursor.current;
    return true;
  };
  useGSAP(() => { arm(); }, { scope: frame, dependencies: [width, points.length] });

  const n = points.length;
  const w = Math.max(width, 1);
  const prices = points.map(p => p.price);
  const min = Math.min(...prices), max = Math.max(...prices), span = max - min || Math.abs(max) * .02 || 1;
  const usable = Math.max(1, height - pad.top - pad.bottom);
  const xAt = (i: number) => n > 1 ? (i / (n - 1)) * w : w / 2;
  const yAt = (i: number) => pad.top + (1 - (prices[i] - min) / span) * usable;
  const coords = points.map((_, i) => ({ x: xAt(i), y: yAt(i) }));
  const line = smooth(coords);
  const area = n > 1 ? `${line} L${w} ${height} L0 ${height} Z` : "";

  const hitAt = (clientX: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || n < 2) return null;
    const rel = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const index = Math.round((rel / rect.width) * (n - 1));
    return { index, x: coords[index].x, y: coords[index].y, width: rect.width, height };
  };

  const show = (hit: TraceHit) => {
    if (!arm()) return;
    if (active.current === null) {
      // Arrive where the pointer is, then glide from there.
      gsap.set(cursor.current, { x: hit.x }); gsap.set(dot.current, { x: hit.x, y: hit.y });
      gsap.to([cursor.current, dot.current], { autoAlpha: 1, duration: prefersReducedMotion() ? 0 : .18, overwrite: "auto" });
    }
    if (active.current === hit.index) return;
    active.current = hit.index;
    moveX.current?.(hit.x); moveDotX.current?.(hit.x); moveDotY.current?.(hit.y);
    onScrub?.(hit);
  };
  const hide = () => {
    if (active.current === null) return;
    active.current = null;
    gsap.to([cursor.current, dot.current], { autoAlpha: 0, duration: prefersReducedMotion() ? 0 : .16, overwrite: "auto" });
    onScrub?.(null);
  };
  useEffect(() => () => { active.current = null; }, []);

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => { if (!scrub) return; const hit = hitAt(event.clientX); if (hit) show(hit); };

  const stroke = tone === "up" ? "var(--trace-up, #3f7d5c)" : tone === "down" ? "var(--trace-down, #a3524b)" : "var(--trace-blue, var(--hub-blue, #2f80ed))";

  return (
    <div ref={frame} className={`price-trace ${className}`} style={{ height }} data-scrub={scrub || undefined}
      onPointerMove={onMove} onPointerEnter={onMove} onPointerLeave={hide} onPointerCancel={hide}
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {n > 1 && width > 0 && (
        <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`} className="price-trace-svg" focusable="false" aria-hidden="true">
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity=".26" />
              <stop offset="55%" stopColor={stroke} stopOpacity=".08" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="trace-area" d={area} fill={`url(#${id}-fill)`} />
          <path className="trace-line" d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <g ref={cursor} className="trace-cursor" aria-hidden="true">
            <line x1="0" x2="0" y1={0} y2={height} stroke={stroke} strokeOpacity=".45" strokeWidth="1" strokeDasharray="2 4" />
          </g>
          <g ref={dot} className="trace-dot" aria-hidden="true">
            <circle r="9" fill={stroke} fillOpacity=".14" />
            <circle r="4" fill="#fff" stroke={stroke} strokeWidth="2" />
          </g>
        </svg>
      )}
    </div>
  );
}

/** Catmull-Rom through every point, expressed as cubic Béziers: the line
 * passes through each reading and bends gently between them. */
export function smooth(points: { x: number; y: number }[]): string {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

/** A hovered reading, said the same way everywhere: when, then how much. */
export function traceDate(time: number, dense = false): string {
  return new Intl.DateTimeFormat("en-US", dense ? { month: "short", day: "numeric", hour: "numeric" } : { month: "short", day: "numeric" }).format(new Date(time));
}
