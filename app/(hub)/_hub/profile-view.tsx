"use client";

import { Bell, Brain, Check, Compass, MessageSquare, Plus, Quote, ShieldCheck, SlidersHorizontal, Wallet, X, type LucideIcon } from "lucide-react";
import { useHubRouter as useRouter } from "./navigation";
import { useEffect, useId, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { limitsError, PERMISSIONS, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN, followedAssets, formatCredits, learnedAssets, limitStatus } from "@/lib/socialtrading/plans";
import { isThemeId, THEMES, type ThemeId } from "@/lib/socialtrading/themes";
import { identityDepth, identityLine, identitySignature, identityStage, identityStats, milestones, nextStep } from "@/lib/socialtrading/identity";
import { shortAddress } from "@/lib/crypto/chains";
import { CharCount, LimitHint, UsagePill } from "./limits-ui";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { AgentRoster, auraTint, IdentityHero, IdentityProgress } from "./identity";
import { knowledgeOf, knowledgePoint, type KnowledgeArea } from "@/lib/socialtrading/knowledge";
import { useGloss } from "./gloss";
import { prefersReducedMotion } from "../../_components/motion";
import { learnedThemes } from "../profile-card";
import { ThemeCards } from "../theme-cards";
import { timeAgo } from "./format";
import { useHub } from "./hub-provider";
import { useLinkedWallets, WalletsSection } from "./wallets";
import { RecoverFunds } from "./recover-funds";
import { DelegateSigning } from "./delegate-signing";
import { DepositFunds } from "./deposit-funds";
import { HubLink as Link } from "./navigation";

const TELL = ["I’m becoming more interested in nuclear", "Stop showing me memecoins", "Add VRT to things I’m watching", "Change my daily limit to $200"];
const ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal, buy: Wallet };
/** The four ways an agent can work with you, as one decision.
 *
 * `buy` is not a fourth permission in the data model — it is `automatic` plus a
 * delegated signer — but it is a fourth *choice* here, because "it can spend
 * without me" is what a person is actually deciding, and burying that in a
 * checkbox somewhere else made it unfindable. */
type Mode = Permission | "buy";
const MODE_LABEL: Record<Mode, string> = { ...PERMISSIONS, buy: "Buy for me" };
const MODE_LINE: Record<Mode, string> = { notify: "It tells you what it sees. Every buy is yours to make.", approve: "It brings you ideas and proposes trades. Nothing moves until you say so.", automatic: "It proposes inside a comfort zone you set. You still sign every one.", buy: "It buys inside your comfort zone while you are away, on Base, using your USDC. Needs a signer you grant and can revoke." };
const money = (v: string) => v && Number.isFinite(Number(v)) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v)) : null;
const list = (items: string[], max = 3) => items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} +${items.length - max}`;

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

/**
 * What the agent knows, as a shape rather than a list. Each area is a body
 * sized by how much it holds and coloured by how sure it is, so the gaps are
 * the visible thing. Reaching for one says what it knows; choosing one opens
 * the part of the page where it is changed.
 */
function KnowledgeField({ areas }: { areas: KnowledgeArea[] }) {
  const gloss = useGloss();
  const field = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (prefersReducedMotion()) return;
    gsap.fromTo("[data-area]", { scale: .4, opacity: 0 }, { scale: 1, opacity: 1, duration: .9, stagger: .06, ease: "creature" });
  }, { scope: field, dependencies: [areas.map(a => a.known.toFixed(2)).join()], revertOnUpdate: true });

  const open = (facet: string) => {
    const section = document.querySelector<HTMLElement>(`[data-facet="${CSS.escape(facet)}"]`);
    section?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    section?.querySelector<HTMLButtonElement>(".hub-facet-toggle")?.focus();
  };

  return <div ref={field} className="hub-knowledge" data-agent-region="identity" aria-label="What your agent knows about you">
    {areas.map((area, index) => {
      const at = knowledgePoint(index, areas.length);
      return <button key={area.id} type="button" className="hub-knowledge-area" data-area data-gap={area.gap ? "true" : undefined}
        style={{ left: `${at.x}%`, top: `${at.y}%`, "--known": area.known, "--sure": area.confidence } as CSSProperties}
        aria-label={`${area.name}. ${area.detail}.${area.gap ? ` ${area.gap}.` : ""}`}
        onClick={() => open(area.facet)}
        {...gloss({ title: area.name, lines: [{ label: "What it knows", value: area.detail }, ...(area.gap ? [{ label: "What would fill this", value: area.gap }] : [])] })}>
        <span className="hub-knowledge-body" aria-hidden="true" />
        <span className="hub-knowledge-name">{area.name}</span>
      </button>;
    })}
  </div>;
}

/** One facet of the person: a heading, the current state in words, and the editor behind "Adjust". */
function Facet({ icon: Icon, title, summary, action = "Adjust", tone = "", children }: { icon: LucideIcon; title: string; summary: ReactNode; action?: string; tone?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className={`hub-facet${open ? " is-open" : ""} ${tone}`} data-facet={title} aria-labelledby={`${id}-title`}>
    <div className="hub-facet-head">
      <span className="hub-facet-medallion" aria-hidden="true"><Icon size={16} strokeWidth={1.7} /></span>
      <div className="hub-facet-copy"><h2 id={`${id}-title`}>{title}</h2><div className="hub-facet-summary">{summary}</div></div>
      <button type="button" className="hub-facet-toggle" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(v => !v)}>{open ? "Done" : action}</button>
    </div>
    <div id={`${id}-body`} className="hub-facet-body"><div className="hub-facet-inner">{children}</div></div>
  </section>;
}

export function ProfileView() {
  const { state, mutate, setDraft, send, name, userId, account, agents, refreshAgents } = useHub();
  const limits = account?.limits ?? DEFAULT_PLAN.limits, planName = account?.planName ?? DEFAULT_PLAN.name;
  const router = useRouter();
  const wallets = useLinkedWallets();
  const [profile, setProfile] = useState<InvestingProfile>(state.profile);
  /** The radio reflects both stored facts, so a saved choice survives a reload. */
  const mode: Mode = profile.autoExecute && profile.permission === "automatic" ? "buy" : profile.permission;
  const [dislikes, setDislikes] = useState(state.dislikes);
  const [preferences, setPreferences] = useState(state.preferences);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const save_ = useRef<HTMLDivElement>(null);
  useEffect(() => { setProfile(state.profile); setDislikes(state.dislikes); setPreferences(state.preferences); }, [state.profile, state.dislikes, state.preferences]);
  useEffect(() => { void refreshAgents(); }, [refreshAgents]);
  const dirty = JSON.stringify({ p: profile, d: dislikes, pr: preferences }) !== JSON.stringify({ p: state.profile, d: state.dislikes, pr: state.preferences });
  const learned = learnedThemes(state.inferred, state.profile.themes);
  const inferredAssets = state.inferred.filter(i => !isThemeId(i.id)).sort((a, b) => Math.abs(b.weight * b.confidence) - Math.abs(a.weight * a.confidence));
  const inferredThemes = state.inferred.filter(i => isThemeId(i.id)).sort((a, b) => b.weight * b.confidence - a.weight * a.confidence);
  const follows = limitStatus(limits, "follows", followedAssets(profile.interests));
  const attention = limitStatus(limits, "preferenceItems", profile.interests.length);
  const learnedStatus = limitStatus(limits, "learnedAssets", learnedAssets(state.inferred));
  /** Adding to “Paying attention to” is blocked when either the section or the follow cap is reached. */
  const attentionFull = attention.atLimit || follows.atLimit;
  const agentName = state.agent?.name ?? (name ? `${name}’s agent` : "Your agent");
  const leaning = [...learned.map(t => THEMES.find(x => x.id === t)!.name), ...inferredAssets.filter(i => i.weight > .25 && i.confidence >= .4).map(i => i.id)].slice(0, 3);
  const themeNames = profile.themes.flatMap(id => THEMES.filter(t => t.id === id).map(t => t.name));
  const signals = state.inferred.reduce((n, i) => n + i.count, 0);
  const roster = agents.length ? agents : state.agent ? [state.agent] : [];
  const stats = identityStats(state, roster);
  const stage = identityStage(identityDepth(state, stats));
  const agentRoom = Math.max(0, limits.agents - stats.agents);

  useGSAP(() => {
    if (!save_.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => { gsap.fromTo(save_.current, { opacity: 0, y: 18, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .45, ease: rubiconMotion.ease.enter, clearProps: "all" }); });
    return () => media.revert();
  }, { dependencies: [dirty || saving || !!savedAt] });

  async function save() {
    setError("");
    if (!profile.thesis.trim()) { setError("Your point of view can’t be empty."); return; }
    if (profile.thesis.length > limits.thesisChars && profile.thesis.length > state.profile.thesis.length) { setError(`Your point of view can be up to ${limits.thesisChars.toLocaleString("en-US")} characters on the ${planName} plan. Shorten it to save.`); return; }
    const anyLimit = Object.values(profile.limits).some(v => v.trim() !== "");
    if (profile.permission === "automatic" || anyLimit) { const m = limitsError(profile.limits); if (m) { setError(profile.permission === "automatic" ? m : `${m} Or clear all three to remove the comfort zone.`); return; } }
    setSaving(true);
    const next = await mutate({ action: "profile", profile: { ...profile, permissionConfigured: true, step: 6, completedAt: profile.completedAt ?? new Date().toISOString() }, dislikes, preferences });
    setSaving(false);
    if (next) setSavedAt(Date.now());
  }
  const tell = (text: string) => { setDraft(text); router.push("/"); };
  const zone = [money(profile.limits.perTrade) && `${money(profile.limits.perTrade)} a trade`, money(profile.limits.daily) && `${money(profile.limits.daily)} a day`, money(profile.limits.weekly) && `${money(profile.limits.weekly)} a week`].filter(Boolean).join(" · ");

  return (
    <div className="hub-profile" style={auraTint()}>
      <IdentityHero name={name || "You"} seed={userId} themes={state.profile.themes} inferred={state.inferred}
        thesis={state.profile.thesis} line={identityLine(state.profile.themes, state.inferred)}
        signature={identitySignature(userId, stats.days)} stage={stage} stats={stats}>
        <div className="hub-identity-marks">
          {wallets[0] && <span className="hub-identity-mark mono"><Wallet size={12} aria-hidden="true" />{shortAddress(wallets[0].address)}{wallets.length > 1 ? ` +${wallets.length - 1}` : ""}</span>}
          <span className="hub-identity-mark">{PERMISSIONS[state.profile.permission]}</span>
          {leaning.length > 0 && <span className="hub-identity-mark is-quiet">{agentName} is leaning into {list(leaning, 2)}</span>}
        </div>
      </IdentityHero>

      <KnowledgeField areas={knowledgeOf(state, stats, identityDepth(state, stats))} />

      <IdentityProgress stage={stage} step={nextStep(state, stats, limits.agents)} earned={milestones(state, stats)} themes={state.profile.themes} />

      <AgentRoster agents={roster} activeId={state.agent?.id} room={agentRoom}
        capNote={`${limits.agents} agents is the most the ${planName} plan allows.`}
        themesOf={agent => agent.id === state.agent?.id ? state.profile.themes : (agent.themes ?? [] as ThemeId[])} />

      <section className="hub-tell">
        <p className="hub-part-title"><MessageSquare aria-hidden="true" />Tell your agent</p>
        <div className="hub-starters">{TELL.map(t => <button key={t} type="button" className="hub-chip-button" onClick={() => tell(t)}>“{t}”</button>)}</div>
      </section>

      <div className="hub-facets">
        <Facet icon={Quote} title="Your point of view" summary={<p className="hub-facet-quote">{profile.thesis.trim() || "No point of view yet. Tell your agent what you believe."}</p>}>
          <div className="hub-field">
            <div className="hub-field-head"><label htmlFor="thesis">In your words</label><CharCount value={profile.thesis} limit={limits.thesisChars} /></div>
            <textarea id="thesis" className="socialtrading-input socialtrading-thesis hub-thesis" value={profile.thesis} maxLength={Math.max(limits.thesisChars, state.profile.thesis.length)} onChange={e => setProfile(p => ({ ...p, thesis: e.target.value }))} />
          </div>
        </Facet>

        <Facet icon={Compass} title="What you care about" summary={<p>{themeNames.length ? themeNames.join(" × ") : "Keeping an open mind"}{profile.interests.length ? <> · watching <strong>{list(profile.interests.map(i => i.symbol || i.name))}</strong></> : ""}{preferences.length ? <> · into {list(preferences)}</> : ""}{dislikes.length ? <> · less {list(dislikes, 2)}</> : ""}</p>}>
          <div className="hub-field">
            <p>Themes</p>
            <ThemeCards selected={profile.themes} thesis={profile.thesis} onChange={themes => setProfile(p => ({ ...p, themes }))} />
          </div>
          <div className="hub-field">
            <div className="hub-field-head"><p>Watching</p><UsagePill limits={limits} limit="follows" used={follows.used} label="followed" /></div>
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
          <div className="hub-field">
            <div className="hub-field-head"><p>Into</p><UsagePill limits={limits} limit="preferenceItems" used={preferences.length} /></div>
            <ChipList items={preferences} empty="Tell me what you’re curious about." placeholder="e.g. nuclear, power grid" full={preferences.length >= limits.preferenceItems} onRemove={v => setPreferences(l => l.filter(x => x !== v))} onAdd={v => setPreferences(l => l.includes(v) || l.length >= limits.preferenceItems ? l : [...l, v])} />
            <LimitHint limits={limits} limit="preferenceItems" used={preferences.length} near={<>{limits.preferenceItems - preferences.length} left in this list.</>} full={<>This list holds {limits.preferenceItems} items on the {planName} plan. Remove one to add another.</>} />
          </div>
          <div className="hub-field">
            <div className="hub-field-head"><p>Show me less</p><UsagePill limits={limits} limit="preferenceItems" used={dislikes.length} /></div>
            <ChipList items={dislikes} empty="Nothing muted." placeholder="e.g. memecoins" full={dislikes.length >= limits.preferenceItems} onRemove={v => setDislikes(l => l.filter(x => x !== v))} onAdd={v => setDislikes(l => l.includes(v) || l.length >= limits.preferenceItems ? l : [...l, v])} />
            <LimitHint limits={limits} limit="preferenceItems" used={dislikes.length} near={<>{limits.preferenceItems - dislikes.length} left in this list.</>} full={<>This list holds {limits.preferenceItems} items on the {planName} plan. Remove one to add another.</>} />
          </div>
        </Facet>

        <Facet icon={ShieldCheck} title="How your agent works with you" summary={<p><strong>{MODE_LABEL[mode]}</strong> · {MODE_LINE[mode]}{profile.permission !== "notify" && zone ? <> Comfort zone: {zone}.</> : ""}</p>}>
          <fieldset className="hub-modes">
            <legend className="sr-only">How your agent works with you</legend>
            {(Object.keys(MODE_LABEL) as Mode[]).map(value => { const Icon = ICONS[value]; const selected = mode === value; return <label key={value} className={`hub-mode${selected ? " is-selected" : ""}`}>
              <input type="radio" name="permission" value={value} checked={selected} onChange={() => setProfile(p => ({
                ...p, permissionConfigured: true,
                permission: value === "buy" ? "automatic" : value,
                // Choosing anything else is also how you stop it spending.
                autoExecute: value === "buy",
              }))} />
              <span className="hub-mode-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.6} /></span>
              <span className="hub-mode-copy"><strong>{MODE_LABEL[value]}</strong><small>{MODE_LINE[value]}</small></span>
              <span className="hub-mode-check" aria-hidden="true">{selected && <Check size={12} />}</span>
            </label>; })}
          </fieldset>
          {/* The signer lives with the choice that needs it, not three fields away. */}
          {mode === "buy" && <div className="hub-field"><DelegateSigning /></div>}
          {profile.permission !== "notify" && <div className="hub-field hub-zone">
            <div className="hub-field-head"><p>{profile.permission === "automatic" ? "Comfort zone · USD" : "Comfort zone · USD (optional)"}</p></div>
            <div className="hub-zone-fields">
              {([["perTrade", "Per trade"], ["daily", "Per day"], ["weekly", "Per week"]] as const).map(([key, label]) => <label key={key} className="hub-zone-field"><span>{label}</span><span className="hub-zone-input"><i aria-hidden="true">$</i><input className="socialtrading-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={profile.limits[key]} onChange={e => setProfile(p => ({ ...p, limits: { ...p.limits, [key]: e.target.value } }))} placeholder="0" /></span></label>)}
            </div>
            <p className="socialtrading-caption">Your agent stays inside these; trades you place yourself don’t count. Checked on the server before anything is quoted.</p>
          </div>}
        </Facet>

        <Facet icon={Brain} title="What your agent remembers" action="Look" summary={<p>{inferredThemes.length || inferredAssets.length ? <>{inferredThemes.length ? `${inferredThemes.length} ${inferredThemes.length === 1 ? "theme" : "themes"}` : ""}{inferredThemes.length && inferredAssets.length ? " and " : ""}{inferredAssets.length ? `${inferredAssets.length} ${inferredAssets.length === 1 ? "asset" : "assets"}` : ""}, picked up from {signals} {signals === 1 ? "signal" : "signals"}. Never a rule; forget any of it.</> : "Nothing yet. Open opportunities, ask follow-ups, or approve and pass on ideas and this fills in."}</p>}>
          {inferredThemes.length > 0 && <div className="hub-field"><p>Themes</p><ul className="hub-inferred">{inferredThemes.map(i => <Inferred key={i.id} id={i.id} label={THEMES.find(t => t.id === i.id)?.name ?? i.id} weight={i.weight} confidence={i.confidence} count={i.count} updatedAt={i.updatedAt} onForget={() => void mutate({ action: "forget", target: i.id })} />)}</ul></div>}
          {(inferredAssets.length > 0 || learnedStatus.atLimit) && <div className="hub-field">
            <div className="hub-field-head"><p>Assets</p><UsagePill limits={limits} limit="learnedAssets" used={learnedStatus.used} label="remembered" /></div>
            <LimitHint limits={limits} limit="learnedAssets" used={learnedStatus.used}
              near={<>I can remember {learnedStatus.remaining} more {learnedStatus.remaining === 1 ? "asset" : "assets"} on the {planName} plan. Forget the ones that no longer matter and I keep learning.</>}
              full={<>I remember {learnedStatus.limit} assets, the most the {planName} plan keeps, so I’ve paused learning new ones. Forget one below and I’ll pick it back up. Themes keep learning either way.</>} />
            <ul className="hub-inferred">{inferredAssets.map(i => <Inferred key={i.id} id={i.id} label={i.id} weight={i.weight} confidence={i.confidence} count={i.count} updatedAt={i.updatedAt} onForget={() => void mutate({ action: "forget", target: i.id })} />)}</ul>
          </div>}
          <div className="hub-field">
            <button type="button" className="hub-chip-button" onClick={() => void send("What have you learned about me so far, and why?")}>“What have you learned about me?”</button>
          </div>
        </Facet>

        <Facet icon={Wallet} title="Plan & wallets" action="Look" tone="is-quiet" summary={<p>{account ? <><strong>{account.planName} plan</strong> · {formatCredits(account.credits.balanceMicros)} credits left</> : <strong>{planName} plan</strong>}{wallets.length ? <> · {wallets.length} {wallets.length === 1 ? "wallet" : "wallets"}</> : " · no wallet yet"}</p>}>
          {account && <div className="hub-field">
            <p>Plan &amp; usage</p>
            <div className="hub-plan-summary" role="group" aria-label="Plan and usage">
              <div className="hub-plan-summary-row"><span><strong>{account.planName} plan</strong> · {formatCredits(account.credits.balanceMicros)} credits left</span><span>{account.credits.requests ? `${formatCredits(account.credits.spentMicros)} used across ${account.credits.requests} model ${account.credits.requests === 1 ? "call" : "calls"}` : "Nothing spent yet"}</span></div>
              <div className="hub-plan-summary-row"><span>{account.usage.agents} of {limits.agents} agents · {account.usage.enabledAgents} of {limits.enabledAgents} running · {account.usage.chats} of {limits.chats} chats</span><Link className="hub-inline-link" href="/agents">Your team</Link></div>
              <div className="hub-plan-summary-row"><span>Credits pay for your agent’s model usage at the provider’s actual cost per request.</span><Link className="hub-inline-link" href="/plans">See plans</Link></div>
            </div>
          </div>}
          <div className="hub-field">
            <p>Wallets for onchain swaps</p>
            <WalletsSection compact />
            <p className="socialtrading-caption">Swaps settle from your own wallet on Uniswap. Your agent proposes them under the mode above, and you sign — unless you grant it a signer below.</p>
          </div>
          <div className="hub-field">
            <p>Deposit USDC</p>
            <DepositFunds />
          </div>
          <div className="hub-field">
            <p>Withdraw funds</p>
            <p className="socialtrading-caption">Withdraw deposited USDC or other supported tokens to your own wallet, on the same network. You review and sign every withdrawal.</p>
            <RecoverFunds />
          </div>
        </Facet>
      </div>

      {(dirty || saving || savedAt) && <div ref={save_} className="hub-save" role="region" aria-label="Unsaved changes">
        {error && <p className="hub-error" role="alert">{error}</p>}
        <div className="hub-save-row">
          <span className="hub-save-text">{saving ? "Saving…" : dirty ? "You changed something." : "Saved"}</span>
          {dirty && <button type="button" className="hub-save-discard" onClick={() => { setProfile(state.profile); setDislikes(state.dislikes); setPreferences(state.preferences); setError(""); }}>Discard</button>}
          {(dirty || saving) && <button type="button" className="hub-save-button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button>}
        </div>
      </div>}
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
