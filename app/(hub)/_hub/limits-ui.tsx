"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { LIMIT_COPY, limitStatus, type AccountSummary, type LimitKey, type PlanLimits } from "@/lib/socialtrading/plans";

/**
 * Quiet plan feedback. The rule everywhere: say nothing while there is room, count when the user is close or
 * interacting, explain and point at the remedy when the cap is reached. Never an error banner.
 */

/** `3 of 5` in the hub's light-blue pill; muted once full. Renders nothing while there is plenty of room unless `always`. */
export function UsagePill({ limits, limit, used, label, always = false, className = "" }: { limits: PlanLimits; limit: LimitKey; used: number; label?: string; always?: boolean; className?: string }) {
  const status = limitStatus(limits, limit, used);
  if (status.unlimited || (!always && !status.nearLimit && !status.atLimit)) return null;
  return <span className={`hub-usage${status.atLimit ? " is-full" : status.nearLimit ? " is-near" : ""} ${className}`} data-tooltip={status.atLimit ? LIMIT_COPY[limit].remedy : undefined}>
    {status.used} of {status.limit}{label ? ` ${label}` : ""}
  </span>;
}

/** One line under a control, only when it matters: near the cap (a heads-up) or at it (what happened and what to do). */
export function LimitHint({ limits, limit, used, near, full, children }: { limits: PlanLimits; limit: LimitKey; used: number; near?: ReactNode; full?: ReactNode; children?: never }) {
  const status = limitStatus(limits, limit, used);
  if (status.unlimited) return null;
  if (status.atLimit) return <p className="hub-limit-hint is-full" role="status">{full ?? <>You’ve reached {status.limit} {LIMIT_COPY[limit].plural} on this plan. {LIMIT_COPY[limit].remedy}</>}</p>;
  if (status.nearLimit) return <p className="hub-limit-hint" role="status">{near ?? <>{status.remaining} {status.remaining === 1 ? "slot" : "slots"} left.</>}</p>;
  return null;
}

/** Characters used against a text cap; appears once the field passes 80% and turns firm at the cap. */
export function CharCount({ value, limit }: { value: string; limit: number }) {
  if (!Number.isFinite(limit) || value.length < limit * .8) return null;
  const over = value.length > limit;
  return <span className={`hub-charcount${over ? " is-over" : value.length >= limit ? " is-full" : ""}`} aria-live="polite">{value.length.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}</span>;
}

/** Remembered dismissals, per user and per hint, so a hint the user already read does not keep coming back. */
export function useDismissed(key: string) {
  const storageKey = `rubicon:hint:${key}`;
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(localStorage.getItem(storageKey) === "1"); } catch { setDismissed(false); } }, [storageKey]);
  const dismiss = useCallback(() => { setDismissed(true); try { localStorage.setItem(storageKey, "1"); } catch { /* storage unavailable */ } }, [storageKey]);
  return [dismissed, dismiss] as const;
}

/** A soft, dismissible one-liner. Used for "here is what your plan includes" the first time the user sees a section. */
export function PlanNote({ id, children }: { id: string; children: ReactNode }) {
  const [dismissed, dismiss] = useDismissed(id);
  if (dismissed) return null;
  return <p className="hub-plan-note" role="note">{children}<button type="button" onClick={dismiss} aria-label="Got it"><X size={12} aria-hidden="true" /></button></p>;
}

export const planName = (account: AccountSummary | null) => account?.planName ?? "Free";
