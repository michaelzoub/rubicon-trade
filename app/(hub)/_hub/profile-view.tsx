"use client";

import { Bell, Check, MessageSquare, Plus, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { limitsError, PERMISSIONS, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN, followedAssets, formatCredits, learnedAssets, limitStatus } from "@/lib/socialtrading/plans";
import { isThemeId, THEMES } from "@/lib/socialtrading/themes";
import { CharCount, LimitHint, UsagePill } from "./limits-ui";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { ProfileAvatar } from "../profile-avatar";
import { learnedThemes } from "../profile-card";
import { ThemeCards } from "../theme-cards";
import { timeAgo } from "./format";
import { useHub } from "./hub-provider";
import { WalletsSection } from "./wallets";
import Link from "next/link";

const TELL = ["I’m becoming more interested in nuclear", "Stop showing me memecoins", "Add VRT to things I’m watching", "Change my daily limit to $200"];
const ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };

function ChipList({ items, onRemove, onAdd, placeholder, empty, full }: { items: string[]; onRemove: (v: string) => void; onAdd: (v: string) => void; placeholder: string; empty: string; /** The list is at its plan cap: adding is disabled and the input says why. */ full?: boolean }) {
  const [value, setValue] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(new Set(items));
  useGSAP(() => {
    const added = items.filter(i => !seen.current.has(i)); seen.current = new Set(items);
    if (!added.length) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const targets = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-chip]") ?? []).filter(n => added.includes(n.dataset.chip ?? ""));
      gsap.fromTo(targets, { opacity: 0, scale: .94, y: 4 }, { opacity: 1, scale: 1, y: 0, duration: .32, stagger: .04, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [items], revertOnUpdate: true });
  return <div ref={root} className="hub-chiplist">
    <div className="socialtrading-chips">
      {items.length === 0 && <span className="is-empty hub-empty-inline">{empty}</span>}
      {items.map(item => <button key={item} type="button" data-chip={item} className="button button-secondary socialtrading-chip socialtrading-chip-selected" onClick={() => onRemove(item)} aria-label={`Remove ${item}`}>{item}<X size={12} aria-hidden="true" /></button>)}
    </div>
    <form className="socialtrading-search" onSubmit={e => { e.preventDefault(); if (value.trim() && !full) { onAdd(value.trim()); setValue(""); } }}>
      <input className="socialtrading-input" value={value} maxLength={100} disabled={full} onChange={e => setValue(e.target.value)} placeholder={full ? "Remove one to add another" : placeholder} aria-label={placeholder} />
      <button type="submit" className="button button-secondary" disabled={!value.trim() || full}><Plus size={14} aria-hidden="true" />Add</button>
    </form>
  </div>;
}

export function ProfileView() {
  const { state, mutate, setDraft, send, name, userId, account } = useHub();
  const limits = account?.limits ?? DEFAULT_PLAN.limits, planName = account?.planName ?? DEFAULT_PLAN.name;
  const router = useRouter();
  const [profile, setProfile] = useState<InvestingProfile>(state.profile);
  const [dislikes, setDislikes] = useState(state.dislikes);
  const [preferences, setPreferences] = useState(state.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => { setProfile(state.profile); setDislikes(state.dislikes); setPreferences(state.preferences); }, [state.profile, state.dislikes, state.preferences]);
  const dirty = JSON.stringify({ p: profile, d: dislikes, pr: preferences }) !== JSON.stringify({ p: state.profile, d: state.dislikes, pr: state.preferences });
  const learned = learnedThemes(state.inferred, state.profile.themes);
  const inferredAssets = state.inferred.filter(i => !isThemeId(i.id)).sort((a, b) => Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence));
  const inferredThemes = state.inferred.filter(i => isThemeId(i.id)).sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
  const follows = limitStatus(limits, "follows", followedAssets(profile.interests));
  const attention = limitStatus(limits, "preferenceItems", profile.interests.length);
  const learnedStatus = limitStatus(limits, "learnedAssets", learnedAssets(state.inferred));
  /** Adding to “Paying attention to” is blocked when either the section or the follow cap is reached. */
  const attentionFull = attention.atLimit || follows.atLimit;

  async function save() {
    setError("");
    if (!profile.thesis.trim()) { setError("Your thesis can’t be empty."); return; }
    if (profile.thesis.length > limits.thesisChars && profile.thesis.length > state.profile.thesis.length) { setError(`Your point of view can be up to ${limits.thesisChars.toLocaleString("en-US")} characters on the ${planName} plan. Shorten it to save.`); return; }
    const anyLimit = Object.values(profile.limits).some(v => v.trim() !== "");
    if (profile.permission === "automatic" || anyLimit) { const m = limitsError(profile.limits); if (m) { setError(profile.permission === "automatic" ? m : `${m} Or clear all three to remove limits.`); return; } }
    setSaving(true);
    const next = await mutate({ action: "profile", profile: { ...profile, permissionConfigured: true, step: 5, completedAt: profile.completedAt ?? new Date().toISOString() }, dislikes, preferences });
    setSaving(false);
    if (next) setSavedAt(Date.now());
  }
  const tell = (text: string) => { setDraft(text); router.push("/"); };

  return (
    <div className="hub-profile">
      <header className="hub-profile-head">
        <ProfileAvatar seed={state.agent?.id ?? userId} themes={state.profile.themes} inferred={learned} className="hub-profile-badge" />
        <div>
          <p className="eyebrow">Profile</p>
          <h1 className="landing-section-title">{state.agent?.name ?? (name ? `${name}’s agent` : "Your agent")}</h1>
          <p>Your interests, your preferences, your pace.</p>
        </div>
      </header>

      <section className="hub-tell">
        <p className="hub-part-title"><MessageSquare aria-hidden="true" />Tell your agent</p>
        <div className="hub-starters">{TELL.map(t => <button key={t} type="button" className="hub-chip-button" onClick={() => tell(t)}>“{t}”</button>)}</div>
      </section>

      <div className="hub-profile-columns">
        <section className="hub-profile-section" aria-labelledby="explicit">
          <h2 id="explicit" className="hub-section-title">What you told me</h2>

          <details className="hub-settings-card" name="profile-settings"><summary>Your interests<span>{profile.themes.length} themes · {profile.interests.length} watching</span></summary><div className="hub-settings-body"><div className="hub-field">
            <div className="hub-field-head"><label htmlFor="thesis">Your point of view</label><CharCount value={profile.thesis} limit={limits.thesisChars} /></div>
            <textarea id="thesis" className="socialtrading-input socialtrading-thesis hub-thesis" value={profile.thesis} maxLength={Math.max(limits.thesisChars, state.profile.thesis.length)} onChange={e => setProfile(p => ({ ...p, thesis: e.target.value }))} />
          </div>
          <div className="hub-field">
            <p>Core interests</p>
            <ThemeCards selected={profile.themes} thesis={profile.thesis} onChange={themes => setProfile(p => ({ ...p, themes }))} />
          </div>
          <div className="hub-field">
            <div className="hub-field-head"><p>Paying attention to</p><UsagePill limits={limits} limit="follows" used={follows.used} label="followed" /></div>
            <ChipList items={profile.interests.map(i => i.symbol || i.name)} empty="Nothing yet." placeholder="Add a ticker, coin, or idea" full={attentionFull}
              onRemove={label => setProfile(p => ({ ...p, interests: p.interests.filter(i => (i.symbol || i.name) !== label) }))}
              onAdd={label => setProfile(p => {
                const interest = /^[A-Za-z.\-]{1,6}$/.test(label) ? { id: label.toUpperCase(), name: label.toUpperCase(), symbol: label.toUpperCase(), kind: "stock" as const } : { id: `custom:${label.toLowerCase()}`, name: label, kind: "custom" as const };
                if (p.interests.length >= limits.preferenceItems || p.interests.some(i => (i.symbol || i.name).toLowerCase() === label.toLowerCase())) return p;
                if (interest.kind !== "custom" && followedAssets(p.interests) >= limits.follows) { setError(`You’re following ${limits.follows} of ${limits.follows} assets on the ${planName} plan. Unfollow one to follow ${label.toUpperCase()}.`); return p; }
                return { ...p, interests: [...p.interests, interest] };
              })} />
            <LimitHint limits={limits} limit="follows" used={follows.used}
              near={<>{follows.remaining} more {follows.remaining === 1 ? "asset" : "assets"} to follow on the {planName} plan. Ideas that aren’t tickers don’t count.</>}
              full={<>You follow {follows.limit} assets, the most the {planName} plan keeps. Unfollow one here (or on any asset) to follow another; ideas that aren’t tickers still fit.</>} />
          </div>
          </div></details><details className="hub-settings-card" name="profile-settings"><summary>Your preferences<span>{preferences.length} interests · {dislikes.length} muted</span></summary><div className="hub-settings-body"><div className="hub-field">
            <div className="hub-field-head"><p>Things you care about</p><UsagePill limits={limits} limit="preferenceItems" used={preferences.length} /></div>
            <ChipList items={preferences} empty="Tell me what you’re curious about." placeholder="e.g. nuclear, power grid" full={preferences.length >= limits.preferenceItems} onRemove={v => setPreferences(l => l.filter(x => x !== v))} onAdd={v => setPreferences(l => l.includes(v) || l.length >= limits.preferenceItems ? l : [...l, v])} />
            <LimitHint limits={limits} limit="preferenceItems" used={preferences.length} near={<>{limits.preferenceItems - preferences.length} left in this list.</>} full={<>This list holds {limits.preferenceItems} items on the {planName} plan. Remove one to add another.</>} />
          </div>
          <div className="hub-field">
            <div className="hub-field-head"><p>Show me less</p><UsagePill limits={limits} limit="preferenceItems" used={dislikes.length} /></div>
            <ChipList items={dislikes} empty="Nothing muted." placeholder="e.g. memecoins" full={dislikes.length >= limits.preferenceItems} onRemove={v => setDislikes(l => l.filter(x => x !== v))} onAdd={v => setDislikes(l => l.includes(v) || l.length >= limits.preferenceItems ? l : [...l, v])} />
            <LimitHint limits={limits} limit="preferenceItems" used={dislikes.length} near={<>{limits.preferenceItems - dislikes.length} left in this list.</>} full={<>This list holds {limits.preferenceItems} items on the {planName} plan. Remove one to add another.</>} />
          </div>
          </div></details><details className="hub-settings-card" name="profile-settings"><summary>Agent permissions<span>{PERMISSIONS[profile.permission]}</span></summary><div className="hub-settings-body"><div className="hub-field">
            <p>Agent mode</p>
            <fieldset className="socialtrading-options">
              <legend className="sr-only">Agent permissions</legend>
              {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => { const Icon = ICONS[value]; const selected = profile.permission === value; return <label key={value} className="socialtrading-option">
                <input type="radio" name="permission" value={value} checked={selected} onChange={() => setProfile(p => ({ ...p, permission: value, permissionConfigured: true }))} />
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span><span className="socialtrading-option-check" aria-hidden="true">{selected && <Check size={12} />}</span>
              </label>; })}
            </fieldset>
          </div>
          {profile.permission !== "notify" && <div className="hub-field">
            <p>{profile.permission === "automatic" ? "Your agent’s limits · USD" : "Your agent’s limits · USD (optional)"}</p>
            <div className="socialtrading-limits">
              {([["perTrade", "Maximum per trade"], ["daily", "Daily limit"], ["weekly", "Weekly limit"]] as const).map(([key, label]) => <label key={key}>{label}<input className="socialtrading-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={profile.limits[key]} onChange={e => setProfile(p => ({ ...p, limits: { ...p.limits, [key]: e.target.value } }))} placeholder="0.00" /></label>)}
            </div>
            <p className="socialtrading-caption socialtrading-limit-note">Enforced on the server before any order or quote is reserved: your agent can’t propose a trade when its value plus what it already committed in the last 24 hours or 7 days would exceed these. Trades you place yourself aren’t capped and don’t count against them.</p>
          </div>}
          </div></details>
          {error && <p className="hub-error" role="alert">{error}</p>}
          <div className="socialtrading-actions" hidden={!dirty && !saving && !savedAt}>
            <button type="button" className="button button-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>
            {dirty && <button type="button" className="button button-secondary" onClick={() => { setProfile(state.profile); setDislikes(state.dislikes); setPreferences(state.preferences); }}>Discard</button>}
            {!dirty && savedAt && <span className="socialtrading-caption" role="status">Saved</span>}
          </div>
        </section>

        <section className="hub-profile-section" aria-labelledby="learned"><details className="hub-settings-card" name="profile-settings"><summary id="learned">What your agent remembers<span>{state.inferred.length} learned interests</span></summary><div className="hub-settings-body">
          
          <p className="hub-section-lead">Inferred from how you explore. Never a rule, and you can clear any of it.</p>
          {inferredThemes.length === 0 && inferredAssets.length === 0 && <p className="hub-empty">Nothing yet. Open opportunities, ask follow-ups, or approve and reject ideas and this fills in.</p>}
          {inferredThemes.length > 0 && <div className="hub-field"><p>Themes</p><ul className="hub-inferred">{inferredThemes.map(i => <Inferred key={i.id} id={i.id} label={THEMES.find(t => t.id === i.id)?.name ?? i.id} weight={i.weight} confidence={i.confidence} count={i.count} updatedAt={i.updatedAt} onForget={() => void mutate({ action: "forget", target: i.id })} />)}</ul></div>}
          {(inferredAssets.length > 0 || learnedStatus.atLimit) && <div className="hub-field">
            <div className="hub-field-head"><p>Assets</p><UsagePill limits={limits} limit="learnedAssets" used={learnedStatus.used} label="remembered" /></div>
            <LimitHint limits={limits} limit="learnedAssets" used={learnedStatus.used}
              near={<>I can remember {learnedStatus.remaining} more {learnedStatus.remaining === 1 ? "asset" : "assets"} on the {planName} plan. Forget the ones that no longer matter and I keep learning.</>}
              full={<>I remember {learnedStatus.limit} assets, the most the {planName} plan keeps, so I’ve paused learning new ones. Forget one below and I’ll pick it back up. Themes keep learning either way.</>} />
            <ul className="hub-inferred">{inferredAssets.map(i => <Inferred key={i.id} id={i.id} label={i.id} weight={i.weight} confidence={i.confidence} count={i.count} updatedAt={i.updatedAt} onForget={() => void mutate({ action: "forget", target: i.id })} />)}</ul>
          </div>}
          </div></details>
          {account && <details className="hub-settings-card" name="profile-settings"><summary>Plan &amp; usage<span>{account.planName}</span></summary><div className="hub-field">
            <p>Plan &amp; usage</p>
            <div className="hub-plan-summary" role="group" aria-label="Plan and usage">
              <div className="hub-plan-summary-row"><span><strong>{account.planName} plan</strong> · {formatCredits(account.credits.balanceMicros)} credits left</span><span>{account.credits.requests ? `${formatCredits(account.credits.spentMicros)} used across ${account.credits.requests} model ${account.credits.requests === 1 ? "call" : "calls"}` : "Nothing spent yet"}</span></div>
              <div className="hub-plan-summary-row"><span>{account.usage.agents} of {limits.agents} agents · {account.usage.enabledAgents} of {limits.enabledAgents} running · {account.usage.chats} of {limits.chats} chats</span><Link className="hub-inline-link" href="/agents">Manage agents</Link></div>
              <span>Credits pay for your agent’s model usage at the provider’s actual cost per request. Paid plans with more room and more credits are coming.</span>
            </div>
          </div></details>}
          <details className="hub-settings-card" name="profile-settings"><summary>Wallets<span>Connections &amp; balances</span></summary><div className="hub-settings-body"><div className="hub-field">
            <p>Wallets for onchain swaps</p>
            <WalletsSection compact />
            <p className="socialtrading-caption">Swaps settle from your own wallet on Uniswap. Your agent can propose them under the mode above; you always sign. <Link className="hub-inline-link" href="/trade">Open Buy</Link></p>
          </div>
          </div></details><div className="hub-field">
            <p>Ask me to explain</p>
            <button type="button" className="hub-chip-button" onClick={() => void send("What have you learned about me so far, and why?")}>“What have you learned about me?”</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Inferred({ label, weight, confidence, count, updatedAt, onForget }: { id: string; label: string; weight: number; confidence: number; count: number; updatedAt: string; onForget: () => void }) {
  const positive = weight >= 0;
  return <li className="hub-inferred-item">
    <div className="hub-inferred-head"><strong>{label}</strong><span>{positive ? "Interested" : "Not interested"} · {Math.round(Math.abs(weight) * 100)}%</span></div>
    <div className="hub-meter" aria-hidden="true"><span style={{ width: `${Math.round(Math.abs(weight) * 100)}%`, opacity: .35 + confidence * .65 }} /></div>
    <p className="hub-inferred-meta">Confidence {Math.round(confidence * 100)}% from {count} {count === 1 ? "signal" : "signals"} · {timeAgo(updatedAt)}<button type="button" className="hub-inline-link" onClick={onForget}>Forget this</button></p>
  </li>;
}
