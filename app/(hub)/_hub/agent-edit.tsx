"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import type { AgentConfig } from "@/lib/socialtrading/agents/config";
import { DEFAULT_PLAN, followedAssets, limitStatus } from "@/lib/socialtrading/plans";
import { limitsError, type InvestingProfile } from "@/lib/socialtrading/profile";
import { ComfortZoneFields, modeOf, ModeTiles, withMode } from "./agent-modes";
import { RemoteAccess } from "./delegate-signing";
import { useHub } from "./hub-provider";

/**
 * Changing an agent after it exists.
 *
 * Creating an agent asks you everything once and then never asks again, which
 * left no way to say "actually, let it buy for me" — or to take that back — for
 * an agent you already have. This is that way: opened from the agent itself, so
 * the thing you are changing is in front of you while you change it.
 *
 * Four cards, one question each, in the order a person would ask them. Nothing
 * explains itself until you reach for it. The agent's name, its voice and its
 * tools are the system's and are not here.
 */
export function AgentEdit({ agent, onClose }: { agent: AgentConfig; onClose: () => void }) {
  const { state, mutate, account, busy } = useHub();
  const limits = account?.limits ?? DEFAULT_PLAN.limits, planName = account?.planName ?? DEFAULT_PLAN.name;
  const panel = useRef<HTMLDivElement>(null);
  const [profile, setProfile] = useState<InvestingProfile>(state.profile);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const mode = modeOf(profile);
  const follows = limitStatus(limits, "follows", followedAssets(profile.interests));
  const watching = profile.interests.map(i => i.symbol || i.name);
  const dirty = JSON.stringify(profile) !== JSON.stringify(state.profile);

  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const remove = (label: string) => setProfile(p => ({ ...p, interests: p.interests.filter(i => (i.symbol || i.name) !== label) }));
  const add = (label: string) => setProfile(p => {
    if (p.interests.some(i => (i.symbol || i.name).toLowerCase() === label.toLowerCase()) || p.interests.length >= limits.preferenceItems) return p;
    const ticker = /^[A-Za-z.\-]{1,6}$/.test(label);
    if (ticker && followedAssets(p.interests) >= limits.follows) { setError(`You already follow ${limits.follows} assets on the ${planName} plan.`); return p; }
    return { ...p, interests: [...p.interests, ticker
      ? { id: label.toUpperCase(), name: label.toUpperCase(), symbol: label.toUpperCase(), kind: "stock" as const }
      : { id: `custom:${label.toLowerCase()}`, name: label, kind: "custom" as const }] };
  });

  /** Writes the draft. Returns whether it landed, so the remote-access switch can
   * wait for it — the server checks the saved mode and limits, not what is typed. */
  const commit = useCallback(async () => {
    setError(""); setSaved(false);
    if (!profile.thesis.trim()) { setError("A point of view can’t be empty."); return false; }
    if (profile.thesis.length > limits.thesisChars && profile.thesis.length > state.profile.thesis.length) { setError(`Up to ${limits.thesisChars.toLocaleString("en-US")} characters on the ${planName} plan.`); return false; }
    if (profile.permission === "automatic") { const m = limitsError(profile.limits); if (m) { setError(m); return false; } }
    setSaving(true);
    const next = await mutate({ action: "profile", profile: { ...profile, permissionConfigured: true, step: 6, completedAt: profile.completedAt ?? new Date().toISOString() }, dislikes: state.dislikes, preferences: state.preferences });
    setSaving(false);
    if (!next) return false;
    setProfile(next.profile); setSaved(true);
    return true;
  }, [profile, limits, planName, state, mutate]);

  return createPortal(<div className="hub-adjust-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="hub-adjust-title" tabIndex={-1} className="hub-adjust">
      <header className="hub-adjust-head">
        <div>
          <p className="hub-adjust-eyebrow">Adjusting</p>
          <h2 id="hub-adjust-title">{agent.name}</h2>
        </div>
        <button type="button" className="hub-adjust-close" aria-label="Close" onClick={onClose}><X size={15} aria-hidden="true" /></button>
      </header>

      <div className="hub-adjust-body">
        <section className="hub-adjust-card">
          <h3>Point of view</h3>
          <p>What this agent believes</p>
          <textarea className="hub-adjust-thesis" aria-label="Point of view" rows={4}
            value={profile.thesis} maxLength={Math.max(limits.thesisChars, state.profile.thesis.length)}
            onChange={e => setProfile(p => ({ ...p, thesis: e.target.value }))} />
        </section>

        <section className="hub-adjust-card">
          <h3>Watching</h3>
          <p>What it keeps an eye on</p>
          <div className="hub-adjust-chips">
            {watching.length === 0 && <span className="hub-adjust-empty">Nothing yet</span>}
            {watching.map(label => <button key={label} type="button" onClick={() => remove(label)} aria-label={`Stop watching ${label}`}>{label}<X size={11} aria-hidden="true" /></button>)}
          </div>
          <AddInterest full={follows.atLimit || profile.interests.length >= limits.preferenceItems} onAdd={add} />
        </section>

        <section className="hub-adjust-card">
          <h3>How far it can go</h3>
          <p>How much this agent decides on its own</p>
          <ModeTiles mode={mode} onChange={value => setProfile(p => withMode(p, value))} />
        </section>

        {profile.permission !== "notify" && <section className="hub-adjust-card">
          <h3>Comfort zone</h3>
          <p>The most it may spend, in USD</p>
          <ComfortZoneFields limits={profile.limits} onChange={l => setProfile(p => ({ ...p, limits: l }))} />
        </section>}

        {mode === "buy" && <section className="hub-adjust-card">
          <h3>Remote access</h3>
          <p>Buying while you’re away</p>
          <RemoteAccess prepare={commit} />
        </section>}
      </div>

      <footer className="hub-adjust-foot">
        {error && <p className="hub-adjust-error" role="alert">{error}</p>}
        {saved && !dirty && !error && <p className="hub-adjust-saved" role="status">Saved</p>}
        <button type="button" className="hub-adjust-save" disabled={busy || saving || !dirty} onClick={() => void commit()}>{saving ? "Saving…" : "Save changes"}</button>
        <button type="button" className="hub-adjust-done" disabled={saving} onClick={onClose}>{dirty ? "Discard" : "Done"}</button>
      </footer>
    </div>
  </div>, document.body);
}

function AddInterest({ full, onAdd }: { full: boolean; onAdd: (label: string) => void }) {
  const [value, setValue] = useState("");
  return <form className="hub-adjust-add" onSubmit={e => { e.preventDefault(); if (value.trim() && !full) { onAdd(value.trim()); setValue(""); } }}>
    <input value={value} maxLength={100} disabled={full} onChange={e => setValue(e.target.value)}
      placeholder={full ? "Remove one to add another" : "Add a ticker, coin, or idea"} aria-label="Add something to watch" />
    <button type="submit" disabled={!value.trim() || full} aria-label="Add"><Plus size={14} aria-hidden="true" />Add</button>
  </form>;
}
