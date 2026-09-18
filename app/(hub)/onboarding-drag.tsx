"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronsUp, PersonStanding } from "lucide-react";
import { CONFIDENCE, EXPERIENCE } from "@/lib/socialtrading/onboarding";
import { gsap, useGSAP, prefersReducedMotion, rubiconMotion } from "../_components/motion";

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

const DISTANCE_STOPS = [0, 333, 667, 1000];
const CONFIDENCE_DESCRIPTIONS = [
  "You’re open to possibilities and haven’t formed firm convictions yet.",
  "A few instincts are emerging, but they’re still taking shape.",
  "Several convictions feel defined, though some uncertainty remains.",
  "Your convictions feel strong, settled, and easy to stand behind.",
];
const STARS = Array.from({ length: 56 }, (_, i) => {
  const angle = i * 2.399963229728653;
  const radius = .18 + ((i * 37) % 82) / 100;
  return { dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius * .78, size: 1 + i % 3, phase: ((i * 17) % 100) / 100 };
});

const FOCAL_LENGTHS = [24, 50, 85, 135];

function closestStop(kilometres: number) {
  return DISTANCE_STOPS.reduce((closest, stop, index) =>
    Math.abs(stop - kilometres) < Math.abs(DISTANCE_STOPS[closest] - kilometres) ? index : closest, 0);
}

/** Scroll starts at the bottom of the runway (wide / 24mm). Moving toward the
 * top of the overflow is a zoom-in: kilometres grow as scrollTop falls. */
function zoomOf(scrollTop: number, range: number) {
  return (1 - clamp(scrollTop / Math.max(1, range))) * 1000;
}
function scrollOf(kilometres: number, range: number) {
  return (1 - kilometres / 1000) * Math.max(0, range);
}

/** A flight through space. The lens starts wide on the first conviction;
 * scrolling up zooms in, and GSAP keeps each phrase on that ray. */
function ConfidenceJourney({ value, onChange }: ConfidenceJourneyProps) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const shouldSnap = useRef(false);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const { contextSafe } = useGSAP(() => {
    const viewport = scroller.current;
    const scene = root.current;
    if (!viewport || !scene) return;
    const viewportElement: HTMLDivElement = viewport;
    const markers = gsap.utils.toArray<HTMLElement>("[data-distance-stop]", scene);
    const stars = gsap.utils.toArray<HTMLElement>("[data-star]", scene);
    const rings = scene.querySelector<HTMLElement>(".onb-distance-rings");
    const nudge = scene.querySelector<HTMLElement>("[data-nudge]");
    const rail = scene.querySelector<HTMLElement>("[data-rail]");
    const thumb = scene.querySelector<HTMLElement>("[data-rail-thumb]");
    const fill = scene.querySelector<HTMLElement>("[data-rail-fill]");
    const focals = gsap.utils.toArray<HTMLElement>("[data-focal]", scene);
    const frame = scene.querySelector<HTMLElement>(".onb-distance-frame");
    const camera = { kilometres: 0 };
    let cameraTween: gsap.core.Tween | null = null;
    let scrollTween: gsap.core.Tween | null = null;
    let snapDelay: gsap.core.Tween | null = null;
    let isSnapping = false;
    let railPointer: number | null = null;

    gsap.fromTo(scene, { opacity: 0, y: prefersReducedMotion() ? 0 : 8 }, {
      opacity: 1, y: 0, duration: prefersReducedMotion() ? 0 : rubiconMotion.duration.state,
      ease: rubiconMotion.ease.enter,
    });

    function setRail(kilometres: number) {
      if (rail && thumb) {
        const pad = 20;
        const travel = Math.max(0, rail.clientHeight - thumb.offsetHeight - pad * 2);
        const y = pad + (1 - kilometres / 1000) * travel;
        gsap.set(thumb, { y });
        if (fill) gsap.set(fill, { height: Math.max(thumb.offsetHeight * .4, rail.clientHeight - pad - y) });
      }
      focals.forEach((el, i) => {
        const on = closestStop(kilometres) === FOCAL_LENGTHS.length - 1 - i;
        gsap.set(el, { color: on ? "#fff" : "rgba(210,224,255,.42)", scale: on ? 1.08 : 1 });
      });
      if (nudge) gsap.set(nudge, { autoAlpha: kilometres > 80 ? 0 : .78 });
      frame?.toggleAttribute("data-scrolled", kilometres > 12);
    }

    function render(kilometres: number) {
      const sceneHeight = viewportElement.clientHeight;
      const sceneWidth = viewportElement.clientWidth;
      const centerY = sceneHeight * .5;
      markers.forEach((marker, index) => {
        const remaining = DISTANCE_STOPS[index] - kilometres;
        const depth = clamp(1 - Math.max(0, remaining) / 1050);
        const projection = Math.pow(depth, 2.35);
        const hasPassed = remaining < 0;
        const pass = hasPassed ? clamp(-remaining / 145) : 0;
        const blur = hasPassed ? pass * 9 : clamp((remaining - 90) / 110, 0, 8);
        const opacity = hasPassed ? Math.pow(1 - pass, 1.7) : .08 + Math.pow(depth, 1.45) * .92;
        const side = index % 2 === 0 ? -1 : 1;
        const drift = hasPassed ? pass * sceneWidth * .22 : (1 - projection) * sceneWidth * .055;
        gsap.set(marker, {
          x: side * drift,
          xPercent: -50,
          y: centerY + pass * sceneHeight * .26,
          yPercent: -50,
          scale: .32 + projection * .82 + pass * .42,
          autoAlpha: opacity,
          filter: `blur(${blur.toFixed(2)}px)`,
          zIndex: 10 + Math.round(projection * 100),
        });
      });
      stars.forEach((star, index) => {
        const spec = STARS[index];
        const travel = (spec.phase + kilometres / 1000) % 1;
        const dist = (.03 + travel * travel * 1.2) * Math.max(sceneWidth, sceneHeight);
        const fade = travel < .05 ? travel / .05 : travel > .8 ? (1 - travel) / .2 : 1;
        gsap.set(star, {
          x: spec.dx * dist, y: spec.dy * dist, xPercent: -50, yPercent: -50,
          scale: .35 + travel * 2.4, autoAlpha: fade * (.25 + travel * .7),
        });
      });
      if (rings) gsap.set(rings, { scale: 1 + kilometres / 1000 * .55, opacity: .5 + kilometres / 1000 * .35 });
      setRail(kilometres);
    }

    function selectAt(kilometres: number) {
      const selected = closestStop(kilometres);
      if (selected !== valueRef.current) {
        valueRef.current = selected;
        onChangeRef.current(selected);
      }
    }

    function snapToClosest() {
      const range = Math.max(1, viewportElement.scrollHeight - viewportElement.clientHeight);
      const kilometres = zoomOf(viewportElement.scrollTop, range);
      const closestIndex = closestStop(kilometres);
      const target = DISTANCE_STOPS[closestIndex];
      shouldSnap.current = false;
      isSnapping = true;
      scrollTween?.kill();
      scrollTween = gsap.to(viewportElement, {
        scrollTop: scrollOf(target, range),
        duration: prefersReducedMotion() ? 0 : .85,
        ease: "power2.inOut",
        overwrite: "auto",
        onComplete: () => {
          isSnapping = false;
          valueRef.current = closestIndex;
          onChangeRef.current(closestIndex);
        },
      });
    }

    function updateFromScroll() {
      const range = Math.max(1, viewportElement.scrollHeight - viewportElement.clientHeight);
      const targetKilometres = zoomOf(viewportElement.scrollTop, range);
      selectAt(targetKilometres);
      cameraTween?.kill();
      if (prefersReducedMotion()) {
        camera.kilometres = targetKilometres;
        render(camera.kilometres);
      } else {
        cameraTween = gsap.to(camera, {
          kilometres: targetKilometres,
          duration: .42,
          ease: "power3.out",
          overwrite: true,
          onUpdate: () => render(camera.kilometres),
        });
      }
      if (!shouldSnap.current || isSnapping) return;
      snapDelay?.kill();
      snapDelay = gsap.delayedCall(.65, snapToClosest);
    }

    function beginManualInteraction() {
      shouldSnap.current = true;
      if (!isSnapping) return;
      scrollTween?.kill();
      isSnapping = false;
    }

    function railAt(clientY: number) {
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      const pad = 20;
      const fraction = clamp((clientY - rect.top - pad) / Math.max(1, rect.height - pad * 2));
      viewportElement.scrollTop = scrollOf((1 - fraction) * 1000, viewportElement.scrollHeight - viewportElement.clientHeight);
    }
    function onRailDown(event: PointerEvent) {
      if (event.button !== 0 || !rail) return;
      railPointer = event.pointerId;
      rail.setPointerCapture(event.pointerId);
      beginManualInteraction();
      railAt(event.clientY);
    }
    function onRailMove(event: PointerEvent) {
      if (railPointer !== event.pointerId) return;
      railAt(event.clientY);
    }
    function onRailUp(event: PointerEvent) {
      if (railPointer !== event.pointerId) return;
      railPointer = null;
    }
    function onRailWheel(event: WheelEvent) {
      beginManualInteraction();
      viewportElement.scrollTop += event.deltaY;
      event.preventDefault();
    }

    viewportElement.addEventListener("scroll", updateFromScroll, { passive: true });
    viewportElement.addEventListener("wheel", beginManualInteraction, { passive: true });
    viewportElement.addEventListener("pointerdown", beginManualInteraction, { passive: true });
    viewportElement.addEventListener("touchstart", beginManualInteraction, { passive: true });
    rail?.addEventListener("pointerdown", onRailDown);
    rail?.addEventListener("pointermove", onRailMove);
    rail?.addEventListener("pointerup", onRailUp);
    rail?.addEventListener("pointercancel", onRailUp);
    rail?.addEventListener("wheel", onRailWheel, { passive: false });
    const start = valueRef.current ?? 0;
    if (valueRef.current === null) {
      valueRef.current = start;
      onChangeRef.current(start);
    }
    const range = Math.max(0, viewportElement.scrollHeight - viewportElement.clientHeight);
    gsap.set(viewportElement, { scrollTop: scrollOf(DISTANCE_STOPS[start], range) });
    camera.kilometres = DISTANCE_STOPS[start];
    render(camera.kilometres);
    const sync = () => {
      const next = Math.max(0, viewportElement.scrollHeight - viewportElement.clientHeight);
      gsap.set(viewportElement, { scrollTop: scrollOf(camera.kilometres, next) });
      render(camera.kilometres);
    };
    const frameSync = requestAnimationFrame(sync);
    window.addEventListener("resize", sync);
    return () => {
      cameraTween?.kill();
      scrollTween?.kill();
      snapDelay?.kill();
      cancelAnimationFrame(frameSync);
      window.removeEventListener("resize", sync);
      viewportElement.removeEventListener("scroll", updateFromScroll);
      viewportElement.removeEventListener("wheel", beginManualInteraction);
      viewportElement.removeEventListener("pointerdown", beginManualInteraction);
      viewportElement.removeEventListener("touchstart", beginManualInteraction);
      rail?.removeEventListener("pointerdown", onRailDown);
      rail?.removeEventListener("pointermove", onRailMove);
      rail?.removeEventListener("pointerup", onRailUp);
      rail?.removeEventListener("pointercancel", onRailUp);
      rail?.removeEventListener("wheel", onRailWheel);
    };
  }, { scope: root });

  const travelTo = contextSafe((stop: number, index: number) => {
    const viewport = scroller.current;
    if (!viewport) return;
    shouldSnap.current = false;
    valueRef.current = index;
    onChangeRef.current(index);
    gsap.to(viewport, {
      scrollTop: scrollOf(stop, viewport.scrollHeight - viewport.clientHeight),
      duration: prefersReducedMotion() ? 0 : rubiconMotion.duration.section,
      ease: rubiconMotion.ease.enter,
      overwrite: "auto",
    });
  });

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const viewport = scroller.current;
    if (!viewport) return;
    const range = Math.max(1, viewport.scrollHeight - viewport.clientHeight);
    const current = zoomOf(viewport.scrollTop, range);
    const keyTargets: Record<string, number> = {
      ArrowUp: current + 25,
      ArrowRight: current + 25,
      ArrowDown: current - 25,
      ArrowLeft: current - 25,
      PageUp: current + 250,
      PageDown: current - 250,
      Home: 0,
      End: 1000,
    };
    if (!(event.key in keyTargets)) return;
    event.preventDefault();
    shouldSnap.current = true;
    const target = clamp(keyTargets[event.key], 0, 1000);
    gsap.to(viewport, {
      scrollTop: scrollOf(target, range),
      duration: prefersReducedMotion() ? 0 : .45,
      ease: rubiconMotion.ease.enter,
      overwrite: "auto",
    });
  }

  const selected = value ?? 0;
  return <div ref={root} className="onb-distance">
    <div className="onb-distance-frame">
      <div ref={scroller} className="onb-distance-scroll" role="slider" tabIndex={0} aria-label="Clarity of your beliefs"
        aria-valuemin={24} aria-valuemax={135} aria-valuenow={FOCAL_LENGTHS[selected]}
        aria-valuetext={`${CONFIDENCE[selected]}, ${FOCAL_LENGTHS[selected]} millimeters`} onKeyDown={handleKeyDown}>
        <div className="onb-distance-runway">
          <div className="onb-distance-scene">
            <div className="onb-distance-space" aria-hidden="true">
              <div className="onb-distance-nebula" />
              <div className="onb-distance-rings"><i /><i /><i /></div>
              {STARS.map((star, i) => <span key={i} data-star style={{ width: star.size, height: star.size }} />)}
            </div>
            {CONFIDENCE.map((label, index) => <button className="onb-distance-marker" data-distance-stop key={label}
              data-confidence={index} type="button" aria-pressed={selected === index} onClick={() => travelTo(DISTANCE_STOPS[index], index)}>
              {label}
            </button>)}
            <div className="onb-distance-nudge" data-nudge aria-hidden="true"><ChevronsUp size={18} strokeWidth={2.2} /></div>
          </div>
        </div>
      </div>
      <div className="onb-distance-zoom">
        <ol className="onb-distance-focals" aria-hidden="true">
          {[...FOCAL_LENGTHS].reverse().map(mm => <li key={mm} data-focal>{mm}mm</li>)}
        </ol>
        <div className="onb-distance-rail" data-rail aria-hidden="true">
          <div className="onb-distance-rail-fill" data-rail-fill />
          <div className="onb-distance-rail-marks">{DISTANCE_STOPS.map(stop => <i key={stop} />)}</div>
          <div className="onb-distance-rail-thumb" data-rail-thumb />
        </div>
      </div>
    </div>
    <div className="onb-distance-meaning">
      <strong>{CONFIDENCE[selected]}</strong>
      <span>{CONFIDENCE_DESCRIPTIONS[selected]}</span>
    </div>
    <p className="sr-only" role="status" aria-live="polite">{CONFIDENCE[selected]}</p>
  </div>;
}

/** The first foundation is spatial; the second remains a continuous trail. */
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
