"use client";

import { useRef, useState } from "react";
import type { PredictionResponse } from "@/lib/socialtrading/onboarding";
import { useDrag } from "./onboarding-drag";

export const YEARS = { min: 3, max: 11 }, CONFIDENCE = { min: 50, max: 99 }, BELIEF = { min: 1, max: 99 };

export const horizonLabel = (years: number) => Math.round(years) === 11 ? "10+ years" : `${Math.round(years)} years`;
export const yearLabel = (years: number, base = new Date().getFullYear()) => Math.round(years) === 11 ? `${base + 10}+` : `${base + Math.round(years)}`;

/** Position of a value inside the square, as a fraction. Confidence grows
 * toward the top, so its fraction is inverted for CSS. */
export const toFraction = (value: number, { min, max }: { min: number; max: number }) => (value - min) / (max - min);

/** On a stance pad the vertical axis runs through the middle: the top half is
 * agreement, the bottom half is disagreement, and how far from the middle you
 * land is how sure you are. One dot therefore answers both questions. */
export const toBelief = (r: Pick<PredictionResponse, "direction" | "confidence">) =>
  r.confidence === undefined ? 50 : r.direction === "no" ? 100 - r.confidence : r.confidence;
export const fromBelief = (belief: number) => ({
  direction: (belief >= 50 ? "yes" : "no") as PredictionResponse["direction"],
  confidence: Math.round(belief >= 50 ? belief : 100 - belief),
});

/** One square, one dot. Across is how far ahead you are looking, up is how sure
 * you are — both at once, in one gesture, with nothing else on screen. The two
 * ranges are the same control for keyboards and screen readers; they are not
 * drawn, so the card stays a square and a dot. */
export function PredictionPad({ response: r, onChange, stance = false }: {
  response: PredictionResponse;
  onChange: (patch: Partial<PredictionResponse>) => void;
  /** The dot decides the side as well as the conviction, and the card carries
   * no heading because the question is already the screen's own. */
  stance?: boolean;
}) {
  const axis = stance ? BELIEF : CONFIDENCE;
  const [point, setPoint] = useState({ value: stance ? toBelief(r) : r.confidence ?? 75, years: r.years ?? 7 });
  const [placed, setPlaced] = useState(r.confidence !== undefined && r.years !== undefined);
  const up = stance ? point.value >= 50 : r.direction !== "no";
  // A drag moves both values at once; they commit together so a stored
  // prediction never holds one half of a gesture.
  const latest = useRef(point);
  const set = (patch: Partial<typeof point>) => { latest.current = { ...latest.current, ...patch }; setPoint(latest.current); setPlaced(true); };
  const commit = () => onChange({
    years: Math.round(latest.current.years),
    ...(stance ? fromBelief(latest.current.value) : { confidence: Math.round(latest.current.value) }),
  });
  const drag = useDrag<HTMLDivElement>(
    { ...YEARS, value: point.years, onChange: years => set({ years }), onCommit: commit },
    { ...axis, value: point.value, onChange: value => set({ value }), onCommit: commit, invert: true },
    { placeOnPress: true, pad: 14 },
  );
  const { dragging, ...handlers } = drag;
  const x = toFraction(point.years, YEARS) * 100, y = (1 - toFraction(point.value, axis)) * 100;
  const confidence = stance ? fromBelief(point.value).confidence : Math.round(point.value);
  const range = (which: "value" | "years") => {
    const bounds = which === "value" ? axis : YEARS;
    return <input className="onb-pad-range" type="range" {...bounds} step="1" value={point[which]}
      aria-label={which === "value" ? `How sure you are: ${r.category}` : `How far ahead you are looking: ${r.category}`}
      aria-valuetext={which === "value" ? stance ? `${up ? "You see it" : "You don’t see it"}, ${confidence}% sure` : `${confidence}% sure` : horizonLabel(point.years)}
      onChange={event => { const value = Number(event.target.value); set({ [which]: value }); commit(); }} />;
  };
  return <article className={`onb-pad-card${up ? " is-yes" : " is-no"}${placed ? "" : " is-unset"}${stance ? " is-stance" : ""}`}>
    {!stance && <header className="onb-pad-head">
      <span className={`onb-direction ${r.direction}`}>{up ? "You see it" : "You don’t see it"}</span>
      <h2>{r.text}</h2>
    </header>}
    <div className="onb-pad-wrap">
      <div className={`onb-pad${dragging ? " is-dragging" : ""}`} {...handlers} role="group" aria-label={`Place your prediction for: ${r.text}`}>
        <span className="onb-pad-grid" aria-hidden="true" />
        {stance && <span className="onb-pad-divide" aria-hidden="true" />}
        <span className="onb-pad-crosshair" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        <span className="onb-pad-glow" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        <span className="onb-pad-dot" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />
        <span className="onb-pad-axis is-up" aria-hidden="true">{stance ? "I see it, for certain" : "Almost certain"}</span>
        <span className="onb-pad-axis is-down" aria-hidden="true">{stance ? "I don’t see it, ever" : up ? "Possible" : "Almost certainly not"}</span>
        <span className="onb-pad-axis is-left" aria-hidden="true">Sooner</span>
        <span className="onb-pad-axis is-right" aria-hidden="true">Further out</span>
        {!placed && <span className="onb-pad-prompt">Tap or drag anywhere</span>}
        {placed && <span className="onb-pad-readout" data-below={y < 24 || undefined} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true">
          {stance && <>{up ? "You see it" : "You don’t"} · </>}<strong>{confidence}%</strong> sure · <strong>{yearLabel(point.years)}</strong>
        </span>}
        {range("value")}
        {range("years")}
      </div>
    </div>
    <p className="sr-only" aria-live="polite">{placed ? `${stance ? `${up ? "You see it" : "You do not see it"}, ` : ""}${confidence}% sure, ${horizonLabel(point.years)}, by ${yearLabel(point.years)}` : "Place the dot to set how sure you are and how far ahead you’re looking."}</p>
  </article>;
}
