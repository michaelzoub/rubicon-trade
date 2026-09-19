"use client";

import { ArrowLeft, ArrowRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

const R = 9, C = 2 * Math.PI * R;

/** Progress is a ring, not a counter. The fraction is drawn; the position is
 * spoken. Nobody reads "1 of 6" on screen, but a screen reader still gets it. */
export function ProgressRing({ step, total }: { step: number; total: number }) {
  const fraction = total > 0 ? Math.max(0, Math.min(1, step / total)) : 0;
  return <span className="onb-ring" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.round(step)} aria-label={`Step ${Math.max(1, Math.round(step))} of ${total}`}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle className="onb-ring-track" cx="12" cy="12" r={R} />
      <circle className="onb-ring-value" cx="12" cy="12" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - fraction)} />
    </svg>
  </span>;
}

function progressFraction(step: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(1, step / total)) : 0;
}

/** One question, one card, one thing to do. The card holds its height across
 * the whole run so the footer never moves under the cursor, and the stage in
 * the middle takes whatever room is left. `lead` exists for generated cards
 * whose question needs a second line — the fixed scenes explain themselves by
 * being touched. */
export function OnboardingCard({ title, lead, step, total, children, onBack, onNext, nextLabel = "Continue", busy = false, error, hint, footer, quietTitle = false, countLabel }: {
  title: string; lead?: string; step: number; total: number; children: ReactNode;
  /** The question is already printed on the thing you are about to throw, so the
   * heading stays in the document for assistive tech but off the screen. */
  quietTitle?: boolean;
  /** Replaces the footer ring with an explicit count, and draws a thin bar at the top. */
  countLabel?: string;
  /** Omitted on the first card, which has nothing to go back to. */
  onBack?: () => void;
  /** Omitted when the card commits itself, as a swipe deck does. */
  onNext?: () => void;
  nextLabel?: string; busy?: boolean; error?: string; hint?: ReactNode; footer?: ReactNode;
}) {
  const fraction = progressFraction(step, total);
  return <article className="onb-card" style={countLabel ? { "--onb-progress": String(fraction) } as CSSProperties : undefined}>
    {countLabel && <div className="onb-card-clip" aria-hidden="true"><div className="onb-card-bar"><i /></div></div>}
    <header className={`onb-card-head${quietTitle ? " is-quiet" : ""}`}>
      <h1 className="onb-card-title" aria-hidden={quietTitle || undefined}>{title}</h1>
      {lead && <p className="onb-card-lead">{lead}</p>}
    </header>
    <div className="onb-card-body">{children}</div>
    <div className="onb-card-under">
      {hint && <div className="onb-card-hint">{hint}</div>}
      {error && <p className="onb-error" role="alert">{error}</p>}
      {footer}
    </div>
    <footer className="onb-card-foot">
      {countLabel
        ? <p className="onb-count" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={Math.max(1, Math.round(step))}>{countLabel} {Math.max(1, Math.round(step))} of {total}</p>
        : <ProgressRing step={step} total={total} />}
      <div className="onb-card-buttons">
        {onBack && <button type="button" className="button button-secondary onb-back" onClick={onBack} disabled={busy}><ArrowLeft size={14} aria-hidden="true" />Back</button>}
        {onNext && <button type="button" className="button button-primary" onClick={onNext} disabled={busy}>{nextLabel}<ArrowRight size={14} aria-hidden="true" /></button>}
      </div>
    </footer>
  </article>;
}
