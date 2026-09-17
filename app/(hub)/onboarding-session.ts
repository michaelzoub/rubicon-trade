"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { newProfile, readProfile, profileKey, type InvestingProfile } from "@/lib/socialtrading/profile";
import { newOnboarding } from "@/lib/socialtrading/onboarding";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import type { Variant } from "@/lib/socialtrading/experiment";
import { newRun, saveRun, type Run } from "@/lib/socialtrading/onboarding-metrics";

/** Both arms take exactly these props, so the router can swap them and the
 * three places that mount onboarding never learn there is an experiment. */
export type ArmProps = {
  userId: string; name?: string;
  onComplete?: (profile: InvestingProfile) => void | Promise<void>;
  completing?: boolean; serverError?: string; persist?: boolean; agentCreation?: boolean;
  plan?: { name: string; limits: typeof DEFAULT_PLAN.limits };
  variant: Variant; forced: boolean;
};

/** The profile under construction, mirrored to localStorage when persisting. */
export function useProfileStore(userId: string, persist: boolean) {
  const [profile, setProfile] = useState(() => newProfile(userId));
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      const p = persist ? readProfile(localStorage.getItem(profileKey(userId)), userId) : newProfile(userId);
      setProfile({ ...p, avatarSeed: p.avatarSeed ?? crypto.randomUUID(), investorAnswers: { ...p.investorAnswers, onboarding: p.investorAnswers.onboarding ?? newOnboarding() } });
    } catch { setStorageError("Browser storage is unavailable. Keep this page open to retain your answers."); }
    setLoaded(true);
  }, [persist, userId]);
  useEffect(() => {
    if (!loaded || !persist) return;
    try { localStorage.setItem(profileKey(userId), JSON.stringify(profile)); setStorageError(""); }
    catch { setStorageError("Your answers could not be saved in this browser. Keep this page open."); }
  }, [profile, loaded, persist, userId]);
  return { profile, setProfile, loaded, storageError };
}

/** The run log. Written from the first card on, so an abandoned run is still a
 * record — drop-off is the measurement, not an absence of one. It is kept
 * independent of `persist`, because `/preview` is where both arms get driven. */
export function useRunLog(variant: Variant, forced: boolean) {
  const run = useRef<Run | null>(null);
  const openedAt = useRef(Date.now());
  if (!run.current) run.current = newRun(crypto.randomUUID(), variant, forced, variant === "tree" ? "tree" : "model");

  const flush = useCallback(() => { if (run.current) saveRun(run.current); }, []);

  /** Close out the card being left and open the next. */
  const enter = useCallback((id: string, kind: string) => {
    const r = run.current;
    if (!r) return;
    const elapsed = Date.now() - openedAt.current;
    if (r.abandonedAt) {
      const previous = r.cards.find(c => c.id === r.abandonedAt);
      if (previous) previous.ms += elapsed;
    }
    openedAt.current = Date.now();
    const existing = r.cards.find(c => c.id === id);
    if (existing) existing.revisits += 1; else r.cards.push({ id, kind, ms: 0, revisits: 0 });
    r.abandonedAt = id;
    flush();
  }, [flush]);

  const back = useCallback(() => { if (run.current) { run.current.backs += 1; flush(); } }, [flush]);

  /** The inference arm falls back to the tree's questions when the model is
   * unavailable. Recording that keeps a fallback run out of the arm's rates. */
  const setSource = useCallback((source: Run["source"]) => { if (run.current && run.current.source !== source) { run.current.source = source; flush(); } }, [flush]);

  const finish = useCallback((thesis: string, themes: string[]) => {
    const r = run.current;
    if (!r) return;
    const previous = r.cards.find(c => c.id === r.abandonedAt);
    if (previous) previous.ms += Date.now() - openedAt.current;
    r.completed = true; r.endedAt = new Date().toISOString(); r.abandonedAt = null; r.thesis = thesis; r.themes = themes;
    flush();
  }, [flush]);

  return { enter, back, finish, setSource, source: () => run.current?.source ?? "tree" };
}
