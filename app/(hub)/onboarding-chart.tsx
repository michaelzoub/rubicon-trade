"use client";

import { useRef, useState } from "react";
import type { PredictionResponse } from "@/lib/socialtrading/onboarding";
import { useDrag } from "./onboarding-drag";

export const YEARS = { min: 3, max: 11 }, CONFIDENCE = { min: 50, max: 99 };

export const horizonLabel = (years: number) => Math.round(years) === 11 ? "10+ years" : `${Math.round(years)} years`;
export const yearLabel = (years: number, base = new Date().getFullYear()) => Math.round(years) === 11 ? `${base + 10}+` : `${base + Math.round(years)}`;

/** Position of a value inside the square, as a fraction. Confidence grows
 * toward the top, so its fraction is inverted for CSS. */
export const toFraction = (value: number, { min, max }: { min: number; max: number }) => (value - min) / (max - min);

/** One square, one dot. Across is how far ahead you are looking, up is how sure
 * you are — both at once, in one gesture, with nothing else on screen. The two
 * ranges are the same control for keyboards and screen readers; they are not
 * drawn, so the card stays a square and a dot. */
export function PredictionPad({ response: r, onChange }: { response: PredictionResponse; onChange: (patch: Partial<PredictionResponse>) => void }) {
  const [point, setPoint] = useState({ confidence: r.confidence ?? 75, years: r.years ?? 7 });
  const [placed, setPlaced] = useState(r.confidence !== undefined && r.years !== undefined);
  const up = r.direction !== "no";
  // A drag moves both values at once; they commit together so a stored
  // prediction never holds one half of a gesture.
  const latest = useRef(point);
  const set = (patch: Partial<typeof point>) => { latest.current = { ...latest.current, ...patch }; setPoint(latest.current); setPlaced(true); };
  const commit = () => onChange({ confidence: Math.round(latest.current.confidence), years: Math.round(latest.current.years) });
  const drag = useDrag<HTMLDivElement>(
    { ...YEARS, value: point.years, onChange: years => set({ years }), onCommit: commit },
    { ...CONFIDENCE, value: point.confidence, onChange: confidence => set({ confidence }), onCommit: commit, invert: true },
    { placeOnPress: true, pad: 14 },
  );
  const { dragging, ...handlers } = drag;
  const x = toFraction(point.years, YEARS) * 100, y = (1 - toFraction(point.confidence, CONFIDENCE)) * 100;
  const confidence = Math.round(point.confidence);
  const range = (axis: "confidence" | "years") => {
    const bounds = axis === "confidence" ? CONFIDENCE : YEARS;
    return <input className="onb-pad-range" type="range" {...bounds} step="1" value={axis === "confidence" ? point.confidence : point.years}
      aria-label={axis === "confidence" ? `How sure you are: ${r.category}` : `How far ahead you are looking: ${r.category}`}
      aria-valuetext={axis === "confidence" ? `${confidence}% sure` : horizonLabel(point.years)}
      onChange={event => { const value = Number(event.target.value); set({ [axis]: value }); commit(); }} />;
  };
  return <article className={`onb-pad-card${up ? " is-yes" : " is-no"}${placed ? "" : " is-unset"}`}>
    <header className="onb-pad-head">
      <span className={`onb-direction ${r.direction}`}>{up ? "You see it" : "You don’t see it"}</span>
      <h2>{r.text}</h2>
    </header>
    <div className="onb-pad-wrap">
      <span className="onb-pad-axis is-up">Almost certain</span>
      <div className={`onb-pad${dragging ? " is-dragging" : ""}`} {...handlers} role="group" aria-label={`Place your prediction for: ${r.text}`}>
        <span className="onb-pad-grid" aria-hidden="true" />
        <span className="onb-pad-crosshair" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        <span className="onb-pad-dot" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        {!placed && <span className="onb-pad-prompt">Tap or drag anywhere</span>}
        {range("confidence")}
        {range("years")}
      </div>
      <span className="onb-pad-axis is-down">{up ? "Possible" : "Almost certainly not"}</span>
      <span className="onb-pad-axis is-left">Sooner</span>
      <span className="onb-pad-axis is-right">Further out</span>
    </div>
    <p className="onb-pad-readout" aria-live="polite">{placed ? <><strong>{confidence}% sure</strong> · <strong>{horizonLabel(point.years)}</strong> · by {yearLabel(point.years)}</> : "Place the dot to set how sure you are and how far ahead you’re looking."}</p>
  </article>;
}
