"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bell, Bot, Check, Clock, MessageSquare, Minus, Play, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { CADENCES, CAPABILITIES, defaultAgent, MAX_NOTIFICATIONS_PER_DAY, THRESHOLDS, type AgentConfig } from "@/lib/socialtrading/agents/config";
import { limitsError, PERMISSIONS, type Interest, type Limits, type Permission } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN, followedAssets, limitStatus, type PlanLimits } from "@/lib/socialtrading/plans";
import { CharCount, LimitHint, UsagePill } from "./limits-ui";
import type { RunOutcome, RunRecord } from "@/lib/socialtrading/runtime/types";
import type { HubState } from "@/lib/socialtrading/types";
import { ProfileAvatar } from "../profile-avatar";
import { timeAgo } from "./format";
import { useHub } from "./hub-provider";

type Draft = { config: AgentConfig; thesis: string; interests: Interest[]; permission: Permission; limits: Limits };
const fromState = (state: HubState): Draft => ({ config: state.agent ?? defaultAgent(), thesis: state.profile.thesis, interests: state.profile.interests, permission: state.profile.permission, limits: state.profile.limits });
const blankDraft = (): Draft => ({ config: { ...defaultAgent(), name: "" }, thesis: "", interests: [], permission: "notify", limits: { perTrade: "", daily: "", weekly: "" } });
const MODE_ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };
const SECTIONS = [
  { id: "identity", label: "Identity" }, { id: "behavior", label: "Behavior" }, { id: "thesis", label: "Thesis & interests" },
  { id: "capabilities", label: "Capabilities" }, { id: "permissions", label: "Permissions" }, { id: "notifications", label: "Notifications" }, { id: "remove", label: "Remove" },
] as const;
type SectionId = typeof SECTIONS[number]["id"];

export function AgentsView() {
  const { state, agents, refreshAgents, switchAgent, createAgent, setAgentEnabled, deleteAgent, runNow, loadRuns, mutate, busy, account } = useHub();
  const limits = account?.limits ?? DEFAULT_PLAN.limits, planName = account?.planName ?? DEFAULT_PLAN.name;
  const MAX_ENABLED_AGENTS = limits.enabledAgents;
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const current = state.agent ?? defaultAgent();
  const [draft, setDraft] = useState<Draft>(() => fromState(state));
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState("");
  const [runs, setRuns] = useState<RunRecord[] | null>(null);
  const [lastOutcome, setLastOutcome] = useState<RunOutcome | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [active, setActive] = useState<SectionId>("identity");
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => { void refreshAgents(); }, [refreshAgents]);
  useEffect(() => { if (mode === "edit") setDraft(fromState(state)); }, [state, mode]);
  useEffect(() => { setRuns(null); setLastOutcome(null); setConfirmDelete(false); let live = true; void loadRuns().then(r => { if (live) setRuns(r); }); return () => { live = false; }; }, [current.id, loadRuns]);


  const baseline = useMemo(() => JSON.stringify(fromState(state)), [state]);
  const dirty = mode === "create" || JSON.stringify(draft) !== baseline;
  const running = agents.filter(a => a.enabled).length;
  const agentCount = limitStatus(limits, "agents", agents.length);
  const edit = useCallback((patch: Partial<Draft>) => { setSaved(false); setProblem(""); setDraft(d => ({ ...d, ...patch })); }, []);
  const editConfig = useCallback((patch: Partial<AgentConfig>) => { setSaved(false); setProblem(""); setDraft(d => ({ ...d, config: { ...d.config, ...patch } })); }, []);
  const editNotifications = (patch: Partial<AgentConfig["notifications"]>) => editConfig({ notifications: { ...draft.config.notifications, ...patch } });

  function startCreate() { setMode("create"); setDraft(blankDraft()); setSaved(false); setProblem(""); setConfirmDelete(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function cancelCreate() { setMode("edit"); setDraft(fromState(state)); setProblem(""); }
  function discard() { setDraft(fromState(state)); setProblem(""); setSaved(false); }
  async function save() {
    setProblem(""); setSaved(false);
    if (!draft.config.name.trim()) { setProblem("Give this agent a name."); return; }
    if (!draft.thesis.trim()) { setProblem("Write the thesis this agent should work from."); return; }
    if (draft.thesis.length > limits.thesisChars && (mode === "create" || draft.thesis.length > state.profile.thesis.length)) { setProblem(`The thesis can be up to ${limits.thesisChars.toLocaleString("en-US")} characters on the ${planName} plan. Shorten it to save.`); return; }
    if (mode === "edit" && draft.permission === "automatic") { const m = limitsError(draft.limits); if (m) { setProblem(m); return; } }
    if (mode === "create") { if (await createAgent({ ...draft.config, thesis: draft.thesis.trim() })) { setMode("edit"); setSaved(true); } return; }
    const next = await mutate({ action: "agent", config: draft.config, thesis: draft.thesis.trim(), interests: draft.interests, permission: draft.permission, limits: draft.limits });
    if (next) setSaved(true);
  }
  async function run() { const outcome = await runNow(); if (outcome) { setLastOutcome(outcome); setRuns(await loadRuns()); } }
  const jump = (id: SectionId) => (event: React.MouseEvent) => { event.preventDefault(); setActive(id); const section = document.getElementById(id); if (section instanceof HTMLDetailsElement) section.open = true; section?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const sections = SECTIONS.filter(s => mode === "edit" || (s.id !== "permissions" && s.id !== "remove")).filter(s => s.id !== "remove" || agents.length > 1);
  const lastRun = runs?.[0];
  const cadence = CADENCES.find(c => c.minutes === current.notifications.cadenceMinutes)?.label.toLowerCase() ?? "on a schedule";
  const statusLine = mode === "create" ? "Starts paused with fresh history and Notify me mode. Turn it on once you like the setup."
    : current.enabled ? `Running · checks ${cadence}${lastRun ? ` · last checked ${timeAgo(lastRun.startedAt)}` : " · first check on the next schedule"}`
    : `Paused · ready whenever you need it`;

  return <div className="hub-agents">
    <header className="hub-view-head hub-agents-head">
      <div><p className="eyebrow">Agent settings</p><h1 className="landing-section-title">Manage agents</h1></div>
      <p>A little help keeping up with what matters to you.</p>
    </header>

    <div className="hub-agents-layout">
      <aside className="hub-agents-rail" aria-label="Your agents">
        <div className="hub-agents-rail-head"><h2 className="hub-section-title">Your agents</h2><span className={`hub-agents-count${running >= MAX_ENABLED_AGENTS ? " is-full" : ""}`}>{running} of {MAX_ENABLED_AGENTS} running</span></div>
        <ul className="hub-agent-list">
          {agents.map(agent => {
            const selected = mode === "edit" && agent.id === current.id;
            const blocked = !agent.enabled && running >= MAX_ENABLED_AGENTS;
            return <li key={agent.id} className={`hub-agent-item${selected ? " is-selected" : ""}${agent.enabled ? " is-running" : " is-paused"}`}>
              <button type="button" className="hub-agent-select" aria-current={selected ? "true" : undefined} disabled={busy} onClick={() => { setMode("edit"); setSaved(false); setProblem(""); void switchAgent(agent.id); }}>
                <ProfileAvatar seed={agent.id} className="hub-agent-avatar" />
                <span className="hub-agent-copy"><strong>{agent.name}</strong><small>{agent.description || "Personal investing agent"}</small></span>
              </button>
              <div className="hub-agent-state">
                <span className="hub-agent-pill">{agent.enabled ? "Running" : "Paused"}</span>
                <Switch checked={agent.enabled} disabled={busy || blocked} label={`${agent.enabled ? "Pause" : "Turn on"} ${agent.name}`} hint={blocked ? `Pause another agent first. Only ${MAX_ENABLED_AGENTS} can run at once.` : undefined} onChange={next => void setAgentEnabled(agent.id, next)} />
              </div>
            </li>;
          })}
        </ul>
        <button type="button" className={`hub-agent-new${mode === "create" ? " is-active" : ""}`} disabled={busy || agentCount.atLimit} onClick={startCreate} data-tooltip={agentCount.atLimit ? `You have ${agentCount.limit} agents, the most the ${planName} plan allows. Delete one to create another.` : undefined}><Plus size={15} aria-hidden="true" />New agent<UsagePill limits={limits} limit="agents" used={agents.length} className="hub-agent-new-count" /></button>
        <LimitHint limits={limits} limit="agents" used={agents.length} near={<>Room for {agentCount.remaining} more {agentCount.remaining === 1 ? "agent" : "agents"} on the {planName} plan.</>} full={<>That’s {agentCount.limit} agents, the most the {planName} plan allows. Delete one to create another.</>} />
        <p className="hub-agents-hint">Up to {MAX_ENABLED_AGENTS} agents run in the background at once. Paused agents keep their history and still answer in the conversation.</p>
        <nav className="hub-agents-toc" aria-label="Settings sections">
          {sections.map(s => <a key={s.id} href={`#${s.id}`} className={active === s.id ? "is-active" : ""} onClick={jump(s.id)}>{s.label}</a>)}
        </nav>
      </aside>

      <form noValidate ref={form} className="hub-agents-form" onSubmit={e => { e.preventDefault(); void save(); }}>
        <header className="hub-agent-summary">
          {mode === "create" ? <span className="hub-agent-summary-badge" aria-hidden="true"><Bot size={26} strokeWidth={1.5} /></span> : <ProfileAvatar seed={current.id} themes={state.profile.themes} className="hub-agent-summary-avatar" />}
          <div className="hub-agent-summary-copy">
            <h2>{mode === "create" ? (draft.config.name.trim() || "New agent") : current.name}</h2>
            <p className={`hub-agent-summary-status${mode === "edit" && current.enabled ? " is-running" : ""}`}>{statusLine}</p>
          </div>
          {mode === "edit" && <div className="hub-agent-summary-actions">
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void setAgentEnabled(current.id, !current.enabled)} data-tooltip={!current.enabled && running >= MAX_ENABLED_AGENTS ? "Pause another agent first." : undefined}>{current.enabled ? "Pause" : "Turn on"}</button>
            <button type="button" className="button button-primary hub-agent-run" disabled={busy} onClick={() => void run()}><Play size={14} aria-hidden="true" />{busy ? "Working…" : "Run now"}</button>
          </div>}
        </header>

        {mode === "edit" && <details className="hub-settings-card" open={lastOutcome ? true : undefined}><summary>Recent checks<span>{lastRun ? timeAgo(lastRun.startedAt) : "No checks yet"}</span></summary><RecentRuns runs={runs} outcome={lastOutcome} /></details>}

        <fieldset disabled={busy} className="hub-agent-sections">
          <Section id="identity" title="Name & purpose" lead={draft.config.description || draft.config.name || "Make this agent your own."}>
            <label className="hub-field">Name<input required maxLength={80} className="socialtrading-input" value={draft.config.name} onChange={e => editConfig({ name: e.target.value })} placeholder="e.g. Long-term investor" /></label>
            <label className="hub-field">Purpose<input maxLength={300} className="socialtrading-input" value={draft.config.description} onChange={e => editConfig({ description: e.target.value })} placeholder="One line on what this agent is for" /></label>
          </Section>

          <Section id="behavior" title="Personality" lead={draft.config.instructions || "Choose how your agent talks and thinks."}>
            <label className="hub-field">Instructions<textarea maxLength={2000} className="socialtrading-input hub-thesis hub-agent-instructions" value={draft.config.instructions} onChange={e => editConfig({ instructions: e.target.value })} placeholder="e.g. Be concise. Challenge my assumptions and explain the risks before the upside." /></label>
          </Section>

          <Section id="thesis" title="Interests" lead={draft.thesis || "What would you like to explore?"}>
            <label className="hub-field"><span className="hub-field-head">Investing thesis<CharCount value={draft.thesis} limit={limits.thesisChars} /></span><textarea required maxLength={Math.max(limits.thesisChars, mode === "edit" ? state.profile.thesis.length : 0)} className="socialtrading-input hub-thesis" value={draft.thesis} onChange={e => edit({ thesis: e.target.value })} placeholder="The ideas and opportunities this agent should focus on" /></label>
            <div className="hub-field">
              <div className="hub-field-head"><p>Paying attention to</p><UsagePill limits={limits} limit="follows" used={followedAssets(draft.interests)} label="followed" /></div>
              <Watchlist items={draft.interests} limits={limits} onChange={interests => edit({ interests })} onBlocked={setProblem} />
              <LimitHint limits={limits} limit="follows" used={followedAssets(draft.interests)} near={<>{limitStatus(limits, "follows", followedAssets(draft.interests)).remaining} more to follow on the {planName} plan; ideas that aren’t tickers don’t count.</>} full={<>This agent follows {limits.follows} assets, the most the {planName} plan keeps. Remove one to add another; ideas that aren’t tickers still fit.</>} />
              {mode === "edit" && <p className="socialtrading-caption hub-agent-caption">Preferences, things to show less of, and what the agent has learned live in its <Link className="hub-inline-link" href="/profile">profile</Link>.</p>}
            </div>
          </Section>

          <Section id="capabilities" title="Connected tools" lead={`${draft.config.capabilities.length} tools available`}>
            <div className="hub-agent-capabilities">
              {CAPABILITIES.map(capability => { const on = draft.config.capabilities.includes(capability.id); return <label key={capability.id} className={`hub-agent-capability${on ? " is-on" : ""}`}>
                <input type="checkbox" checked={on} onChange={e => editConfig({ capabilities: e.target.checked ? [...draft.config.capabilities, capability.id] : draft.config.capabilities.filter(id => id !== capability.id) })} />
                <span className="hub-agent-capability-check" aria-hidden="true">{on && <Check size={12} />}</span>
                <span><strong>{capability.name}</strong><small>{capability.description}</small></span>
              </label>; })}
            </div>
            <p className="socialtrading-caption hub-agent-caption">Massive, CoinGecko, DexScreener and DefiLlama provide data when configured on this deployment. Robinhood · {mode === "edit" && current.id === "default" && state.brokerage?.connected ? "Connected" : "Not connected"}.</p>
          </Section>

          {mode === "edit" && <Section id="permissions" title="Permissions" lead={PERMISSIONS[draft.permission]}>
            <fieldset className="socialtrading-options hub-agent-modes">
              <legend className="sr-only">Agent mode</legend>
              {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => { const Icon = MODE_ICONS[value]; const on = draft.permission === value; return <label key={value} className="socialtrading-option">
                <input type="radio" name="permission" value={value} checked={on} onChange={() => edit({ permission: value })} />
                <Icon size={18} strokeWidth={1.5} aria-hidden="true" /><span>{label}</span><span className="socialtrading-option-check" aria-hidden="true">{on && <Check size={12} />}</span>
              </label>; })}
            </fieldset>
            {draft.permission === "automatic" && <div className="hub-field">
              <p>Your limits · USD</p>
              <div className="socialtrading-limits">
                {([["perTrade", "Maximum per trade"], ["daily", "Daily limit"], ["weekly", "Weekly limit"]] as const).map(([key, label]) => <label key={key}>{label}<input className="socialtrading-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.limits[key]} onChange={e => edit({ limits: { ...draft.limits, [key]: e.target.value } })} placeholder="0.00" /></label>)}
              </div>
            </div>}
            <p className="socialtrading-caption hub-agent-caption">Scheduled checks never place trades in any mode. Trades only happen in the conversation, under these rules.</p>
          </Section>}

          <Section id="notifications" title="Notifications" lead={`${CADENCES.find(c => c.minutes === draft.config.notifications.cadenceMinutes)?.label ?? "Scheduled"} · up to ${draft.config.notifications.maxPerDay} updates a day`}>
            <div className="hub-field">
              <p>Check the market</p>
              <div className="hub-starters hub-agent-cadence">{CADENCES.map(c => <button key={c.minutes} type="button" className="hub-chip-button" aria-pressed={draft.config.notifications.cadenceMinutes === c.minutes} onClick={() => editNotifications({ cadenceMinutes: c.minutes })}>{c.label}</button>)}</div>
            </div>
            <div className="hub-field">
              <p>Reach out for</p>
              <fieldset className="socialtrading-options hub-agent-thresholds">
                <legend className="sr-only">Relevance threshold</legend>
                {THRESHOLDS.map(t => { const on = draft.config.notifications.threshold === t.id; return <label key={t.id} className="socialtrading-option hub-agent-threshold">
                  <input type="radio" name="threshold" value={t.id} checked={on} onChange={() => editNotifications({ threshold: t.id })} />
                  <span className="hub-agent-threshold-copy"><strong>{t.label}</strong><small>{t.description}</small></span><span className="socialtrading-option-check" aria-hidden="true">{on && <Check size={12} />}</span>
                </label>; })}
              </fieldset>
            </div>
            <div className="hub-field">
              <p>At most</p>
              <div className="hub-agent-stepper">
                <button type="button" aria-label="Fewer reach-outs per day" disabled={draft.config.notifications.maxPerDay <= 1} onClick={() => editNotifications({ maxPerDay: draft.config.notifications.maxPerDay - 1 })}><Minus size={14} /></button>
                <output aria-live="polite"><strong>{draft.config.notifications.maxPerDay}</strong> reach-out{draft.config.notifications.maxPerDay === 1 ? "" : "s"} a day</output>
                <button type="button" aria-label="More reach-outs per day" disabled={draft.config.notifications.maxPerDay >= MAX_NOTIFICATIONS_PER_DAY} onClick={() => editNotifications({ maxPerDay: draft.config.notifications.maxPerDay + 1 })}><Plus size={14} /></button>
              </div>
            </div>
          </Section>

          {mode === "edit" && agents.length > 1 && <Section id="remove" title="Remove" lead="Deleting an agent removes its conversation, activity, memory, and trade history for good." tone="danger">
            {!confirmDelete ? <button type="button" className="button button-secondary hub-agent-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" />Delete {current.name}</button>
              : <div className="hub-agent-confirm" role="alertdialog" aria-label={`Delete ${current.name}?`}>
                <p>Delete <strong>{current.name}</strong>? This cannot be undone.</p>
                <div className="socialtrading-actions"><button type="button" className="button button-primary hub-agent-danger-confirm" disabled={busy} onClick={() => void deleteAgent(current.id)}>Yes, delete</button><button type="button" className="button button-secondary" onClick={() => setConfirmDelete(false)}>Keep it</button></div>
              </div>}
          </Section>}
        </fieldset>

        <div className={`hub-agent-actions${dirty || saved || problem ? " is-visible" : ""}`} aria-live="polite">
          <p className={`hub-agent-actions-status${problem ? " is-problem" : ""}`}>{problem || (mode === "create" ? "Ready when you are." : dirty ? "Unsaved changes" : saved ? "Saved" : "")}</p>
          <div className="hub-agent-actions-buttons">
            {mode === "create" ? <button type="button" className="button button-secondary" onClick={cancelCreate}>Cancel</button> : dirty && <button type="button" className="button button-secondary" onClick={discard}>Discard</button>}
            <button className="button button-primary" type="submit" disabled={busy || (!dirty && mode === "edit")}>{busy ? "Saving…" : mode === "create" ? "Create agent" : "Save changes"}</button>
          </div>
        </div>
      </form>
    </div>
  </div>;
}

function Section({ id, title, lead, tone, children }: { id: SectionId; title: string; lead: string; tone?: "danger"; children: ReactNode }) {
  return <details id={id} name="agent-settings" data-section className={`hub-agent-section${tone ? ` is-${tone}` : ""}`} aria-labelledby={`${id}-title`}>
    <summary className="hub-agent-section-head"><span id={`${id}-title`} className="hub-section-title">{title}</span><span className="hub-settings-preview">{lead}</span></summary>
    <div className="hub-agent-section-body">{children}</div>
  </details>;
}

function Switch({ checked, disabled, label, hint, onChange }: { checked: boolean; disabled?: boolean; label: string; hint?: string; onChange: (next: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} data-tooltip={hint ?? label} disabled={disabled} className="hub-switch" onClick={() => onChange(!checked)}><span className="hub-switch-knob" aria-hidden="true" /></button>;
}

function Watchlist({ items, limits, onChange, onBlocked }: { items: Interest[]; limits: PlanLimits; onChange: (next: Interest[]) => void; onBlocked: (message: string) => void }) {
  const [value, setValue] = useState("");
  const labelOf = (i: Interest) => i.symbol || i.name;
  const full = items.length >= limits.preferenceItems;
  function add() {
    const label = value.trim();
    if (!label || items.length >= limits.preferenceItems || items.some(i => labelOf(i).toLowerCase() === label.toLowerCase())) { setValue(""); return; }
    const next: Interest = /^[A-Za-z.\-]{1,6}$/.test(label) ? { id: label.toUpperCase(), name: label.toUpperCase(), symbol: label.toUpperCase(), kind: "stock" } : { id: `custom:${label.toLowerCase()}`, name: label, kind: "custom" };
    if (next.kind !== "custom" && followedAssets(items) >= limits.follows) { onBlocked(`This agent already follows ${limits.follows} of ${limits.follows} assets. Remove one to follow ${next.symbol}.`); setValue(""); return; }
    onChange([...items, next]); setValue("");
  }
  return <div className="hub-chiplist">
    <div className="socialtrading-chips">
      {items.length === 0 && <span className="is-empty hub-empty-inline">Nothing yet. Add tickers, coins, or ideas.</span>}
      {items.map(item => <button key={item.id} type="button" className="button button-secondary socialtrading-chip socialtrading-chip-selected" onClick={() => onChange(items.filter(i => i !== item))} aria-label={`Remove ${labelOf(item)}`}>{labelOf(item)}<X size={12} aria-hidden="true" /></button>)}
    </div>
    <div className="socialtrading-search">
      <input className="socialtrading-input" value={value} maxLength={100} disabled={full} onChange={e => setValue(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={full ? "Remove one to add another" : "Add a ticker, coin, or idea"} aria-label="Add to watchlist" />
      <button type="button" className="button button-secondary" disabled={!value.trim() || full} onClick={add}><Plus size={14} aria-hidden="true" />Add</button>
    </div>
  </div>;
}

function RecentRuns({ runs, outcome }: { runs: RunRecord[] | null; outcome: RunOutcome | null }) {
  return <section className="hub-agent-runs" aria-label="Recent checks">
    <p className="hub-part-title"><Clock size={13} aria-hidden="true" />Recent checks</p>
    {outcome && <p className={`hub-agent-outcome is-${outcome.status}`} role="status">
      {outcome.status === "succeeded" ? (outcome.notification ? <>Reached out: <strong>{outcome.notification.title}</strong>. It’s waiting in your conversation.</> : <>Checked and stayed quiet. {outcome.summary}</>)
        : outcome.status === "skipped" ? outcome.summary : <>The run failed. {outcome.error}</>}
    </p>}
    {runs === null ? <p className="hub-empty-inline">Loading…</p>
      : runs.length === 0 ? <p className="hub-empty-inline">No checks yet. Turn the agent on, or run it now to see how it thinks.</p>
      : <ul className="hub-run-list">{runs.slice(0, 5).map(run => <li key={run.id} className={`hub-run is-${run.status}${run.notified ? " is-notified" : ""}`}>
        <span className="hub-run-dot" aria-hidden="true" />
        <div className="hub-run-copy">
          <p>{run.status === "running" ? "Checking now…" : run.error ?? run.summary ?? "Checked."}</p>
          <small>{timeAgo(run.startedAt)} · {run.trigger === "cron" ? "scheduled" : run.trigger} · {run.notified ? "reached out" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "quiet"}{run.decision?.toolCalls ? ` · ${run.decision.toolCalls} lookup${run.decision.toolCalls === 1 ? "" : "s"}` : ""}</small>
        </div>
      </li>)}</ul>}
  </section>;
}
