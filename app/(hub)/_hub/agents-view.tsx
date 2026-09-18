"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Plus, SlidersHorizontal, X } from "lucide-react";
import type { AgentConfig } from "@/lib/socialtrading/agents/config";
import { DEFAULT_PLAN, limitStatus } from "@/lib/socialtrading/plans";
import { badgePalette, isThemeId, THEMES, type ThemeId } from "@/lib/socialtrading/themes";
import { avatarTraits } from "@/lib/socialtrading/avatar";
import type { RunOutcome, RunRecord } from "@/lib/socialtrading/runtime/types";
import type { HubState } from "@/lib/socialtrading/types";
import { AgentEdit } from "./agent-edit";
import { ProfileFlow } from "../social-trading";
import { ProfileAvatar } from "../profile-avatar";
import { timeAgo } from "./format";
import { useHub } from "./hub-provider";
import { useHubRouter as useRouter } from "./navigation";

/** What a card and its reveal know about one agent, read without switching to it. */
type Glimpse = { state: HubState | null; runs: RunRecord[] };

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(", ");
/** Per-agent colour: the same blend the badge wears, so card and avatar agree. */
function identity(agent: AgentConfig, themes: ThemeId[], profile?: HubState["profile"]): CSSProperties {
  const palette = badgePalette(themes, avatarTraits(profile?.avatarSeed ?? agent.badge?.seed ?? agent.id).color);
  return { "--agent-light": palette.light, "--agent-color": palette.color, "--agent-dark": palette.dark, "--agent-rgb": rgb(palette.color) } as CSSProperties;
}
/** Everything the agent has its eye on, in the order a person would say it: what they named, what they told it, what it picked up. */
function attention(state: HubState | null) {
  if (!state) return [];
  const named = state.profile.interests.map(i => i.symbol || i.name);
  const learned = state.inferred.filter(i => !isThemeId(i.id) && i.weight > .25 && i.confidence >= .4).sort((a, b) => b.weight * b.confidence - a.weight * a.confidence).map(i => i.id);
  return [...new Set([...named, ...state.preferences, ...learned])];
}
const purpose = (agent: AgentConfig, themes: ThemeId[]) => agent.description || (themes.length ? `${themes.map(id => THEMES.find(t => t.id === id)!.name).join(" × ")} through your point of view` : "Shaped around your point of view");
/** A run's story in one plain line. Failures are not the user's problem to debug. */
const noticed = (run: RunRecord) => run.status === "failed" ? "Couldn’t finish looking; it will try again." : run.status === "running" ? "Looking now…" : run.summary ?? "Looked around and stayed quiet.";

export function AgentsView() {
  const { state, agents, refreshAgents, switchAgent, createAgent, setAgentEnabled, deleteAgent, runNow, inspectAgent, busy, account, error, userId, name } = useHub();
  const router = useRouter();
  const limits = account?.limits ?? DEFAULT_PLAN.limits, planName = account?.planName ?? DEFAULT_PLAN.name;
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  /** The agent whose settings are open. Adjusting one means becoming it first —
   * the hub edits the agent it is on — so this is only honoured once the switch
   * has landed. */
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [glimpses, setGlimpses] = useState<Record<string, Glimpse>>({});
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => { void refreshAgents(); }, [refreshAgents]);
  const themesOf = useCallback((agent: AgentConfig): ThemeId[] => agent.id === state.agent?.id ? state.profile.themes : (glimpses[agent.id]?.state?.profile.themes ?? agent.themes ?? []), [state, glimpses]);
  const glimpse = useCallback(async (id: string) => { const next = await inspectAgent(id); setGlimpses(g => ({ ...g, [id]: next })); return next; }, [inspectAgent]);
  const ids = agents.map(a => a.id).join(",");
  useEffect(() => { let live = true; void Promise.all(agents.map(async a => [a.id, await inspectAgent(a.id)] as const)).then(entries => { if (live) setGlimpses(Object.fromEntries(entries)); }); return () => { live = false; }; },
    // Re-read when the set of agents changes, not on every provider render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ids, inspectAgent]);

  const awake = agents.filter(a => a.enabled).length;
  const capReached = awake >= limits.enabledAgents;
  const count = limitStatus(limits, "agents", agents.length);
  const current = useMemo(() => agents.find(a => a.id === revealed) ?? null, [agents, revealed]);

  const open = (agent: AgentConfig, from: HTMLElement | null) => { returnTo.current = from; setRevealed(agent.id); };
  const adjust = async (agent: AgentConfig) => { setRevealed(null); if (agent.id !== state.agent?.id) await switchAgent(agent.id); setAdjusting(agent.id); };
  const close = () => { setRevealed(null); returnTo.current?.focus(); returnTo.current = null; };
  const wake = async (agent: AgentConfig, enabled: boolean) => { if (await setAgentEnabled(agent.id, enabled)) void glimpse(agent.id); };

  if (creating) return <section className="hub-agents hub-agent-onboarding" aria-label="Begin a new agent">
    <button className="button button-secondary" type="button" disabled={busy} onClick={() => setCreating(false)}><X size={14} aria-hidden="true" />Not now</button>
    <ProfileFlow userId={userId} name={name} persist={false} agentCreation plan={{ name: planName, limits }} completing={busy} serverError={error ?? ""}
      onComplete={async profile => { if (await createAgent({ thesis: profile.thesis, profile, userName: name })) setCreating(false); }} />
  </section>;

  return <div className="hub-agents">
    <header className="hub-view-head hub-agents-head">
      <p className="eyebrow">Your team</p>
      <h1 className="landing-section-title">{agents.length === 1 ? "One agent, working for you." : `${agents.length} agents, working for you.`}</h1>
    </header>

    <ul className="hub-agent-grid" aria-label="Your agents">
      {agents.map(agent => {
        const themes = themesOf(agent), look = glimpses[agent.id], last = look?.runs[0];
        const agentState = agent.id === state.agent?.id ? state : look?.state;
        const watching = attention(agentState ?? null).slice(0, 4);
        return <li key={agent.id} className={`hub-agent-card${agent.enabled ? " is-analyzing" : " is-resting"}`} style={identity(agent, themes, agentState?.profile)}>
          <button type="button" className="hub-agent-card-open" aria-label={`Reveal ${agent.name}`} onClick={e => open(agent, e.currentTarget)} />
          <div className="hub-agent-card-head">
            <ProfileAvatar badge={agent.badge} profile={agentState?.profile} seed={agent.id} themes={themes} className="hub-agent-card-badge" />
            <span className={`hub-agent-status${agent.enabled ? " is-live" : ""}`}><i aria-hidden="true" />{agent.enabled ? "Analyzing" : "Resting"}</span>
          </div>
          <div className="hub-agent-card-copy">
            <h2>{agent.name}</h2>
            <p>{purpose(agent, themes)}</p>
          </div>
          <div className="hub-agent-card-foot">
            {watching.length > 0 && <div className="hub-agent-watching" aria-label="Paying attention to">{watching.map(w => <span key={w}>{w}</span>)}</div>}
            {agent.enabled
              ? <p className="hub-agent-card-note">{last ? <>{noticed(last)} <small>{timeAgo(last.startedAt)}</small></> : "Getting to know what you follow."}</p>
              : <button type="button" className="hub-agent-wake" disabled={busy || capReached} data-tooltip={capReached ? `Two agents can analyze at once on the ${planName} plan. Let one rest first.` : undefined} onClick={() => void wake(agent, true)}>Wake up</button>}
          </div>
        </li>;
      })}
      <li className="hub-agent-card is-new">
        <button type="button" className="hub-agent-card-open" disabled={busy || count.atLimit} data-tooltip={count.atLimit ? `${count.limit} agents is the most the ${planName} plan allows. Say goodbye to one to begin another.` : undefined} onClick={() => setCreating(true)}>
          <span className="hub-agent-new-mark" aria-hidden="true"><Plus size={18} strokeWidth={1.6} /></span>
          <span className="hub-agent-new-copy"><strong>Begin a new agent</strong><small>{count.atLimit ? "Your team is full" : count.remaining === 1 ? "Room for one more" : `Room for ${count.remaining} more`}</small></span>
        </button>
      </li>
    </ul>

    {current && <AgentReveal agent={current} themes={themesOf(current)} look={current.id === state.agent?.id ? { state, runs: glimpses[current.id]?.runs ?? [] } : glimpses[current.id]} busy={busy} canRest={agents.length > 1} capReached={capReached} planName={planName}
      onClose={close}
      onWake={enabled => void wake(current, enabled)}
      onLook={async () => { const outcome = await runNow(current.id); void glimpse(current.id); return outcome; }}
      onTalk={async () => { close(); if (current.id !== state.agent?.id) await switchAgent(current.id); router.push("/"); }}
      onAdjust={() => void adjust(current)}
      onGoodbye={async () => { if (await deleteAgent(current.id)) close(); }} />}

    {adjusting && state.agent?.id === adjusting && <AgentEdit agent={state.agent}
      onClose={() => { const id = adjusting; setAdjusting(null); void glimpse(id); returnTo.current?.focus(); returnTo.current = null; }} />}
  </div>;
}

function AgentReveal({ agent, themes, look, busy, canRest, capReached, planName, onClose, onWake, onLook, onTalk, onAdjust, onGoodbye }: {
  agent: AgentConfig; themes: ThemeId[]; look?: Glimpse; busy: boolean; canRest: boolean; capReached: boolean; planName: string;
  onClose: () => void; onWake: (enabled: boolean) => void; onLook: () => Promise<RunOutcome | null>; onTalk: () => Promise<void>; onAdjust: () => void; onGoodbye: () => Promise<void>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [looking, setLooking] = useState(false);
  const [goodbye, setGoodbye] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", key);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);
  const watching = attention(look?.state ?? null);
  const recent = (look?.runs ?? []).filter(r => r.status === "succeeded" && Boolean(r.summary?.trim())).slice(0, 3);
  const look_ = async () => { setLooking(true); setOutcome(null); try { setOutcome(await onLook()); } finally { setLooking(false); } };

  return createPortal(<div className="hub-reveal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="hub-reveal-name" tabIndex={-1} className="rubicon-hover-surface hub-reveal" style={identity(agent, themes, look?.state?.profile)}>
      <button type="button" className="hub-reveal-close" aria-label="Close" onClick={onClose}><X size={14} aria-hidden="true" /></button>
      <header className="hub-reveal-head">
        <ProfileAvatar badge={agent.badge} profile={look?.state?.profile} seed={agent.id} themes={themes} className="hub-reveal-badge" />
        <div className="hub-reveal-who">
          <h2 id="hub-reveal-name">{agent.name}</h2>
          <p>{purpose(agent, themes)}</p>
          <span className={`hub-agent-status${agent.enabled ? " is-live" : ""}`}><i aria-hidden="true" />{agent.enabled ? "Analyzing" : "Resting"}</span>
        </div>
      </header>
      <section className="hub-reveal-section" aria-label="Paying attention to">
        <p className="hub-reveal-label">Paying attention to</p>
        {look === undefined ? <p className="hub-reveal-quiet">Looking…</p>
          : watching.length ? <div className="hub-reveal-chips">{watching.slice(0, 8).map(w => <span key={w}>{w}</span>)}</div>
          : <p className="hub-reveal-quiet">Still getting to know you.</p>}
      </section>
      <section className="hub-reveal-section" aria-label="Recently noticed">
        <p className="hub-reveal-label">Recently noticed</p>
        {outcome && <p className="hub-reveal-fresh" role="status">{outcome.status === "succeeded" ? (outcome.summary || "Nothing new worth highlighting right now.") : outcome.status === "skipped" ? outcome.summary : "It couldn’t finish looking. Try again in a moment."}</p>}
        {look === undefined ? <p className="hub-reveal-quiet">Looking back…</p>
          : recent.length ? <ul className="hub-reveal-noticed">{recent.map(run => <li key={run.id}><p>{noticed(run)}</p><small>{timeAgo(run.startedAt)}</small></li>)}</ul>
          : !outcome && <p className="hub-reveal-quiet">Nothing new worth highlighting right now.</p>}
      </section>
      <div className="hub-reveal-actions">
        <button type="button" className="hub-reveal-action is-primary" disabled={busy || looking} onClick={() => void look_()}>{looking ? "Looking…" : "Take a look now"}</button>
        <button type="button" className="hub-reveal-action" disabled={busy} onClick={() => void onTalk()}>Talk to it</button>
        <button type="button" className="hub-reveal-action" disabled={busy} onClick={onAdjust}><SlidersHorizontal size={13} aria-hidden="true" />Adjust</button>
        <button type="button" className="hub-reveal-action" disabled={busy || (!agent.enabled && capReached)} data-tooltip={!agent.enabled && capReached ? `Two agents can analyze at once on the ${planName} plan. Let one rest first.` : undefined} onClick={() => onWake(!agent.enabled)}>{agent.enabled ? "Let it rest" : "Wake up"}</button>
      </div>
      {canRest && <footer className="hub-reveal-foot">
        {goodbye
          ? <div className="hub-reveal-goodbye" role="alertdialog" aria-label={`Say goodbye to ${agent.name}?`}><p>Say goodbye to <strong>{agent.name}</strong>? Everything it learned goes with it.</p><div><button type="button" disabled={busy} onClick={() => void onGoodbye()}>Yes, goodbye</button><button type="button" onClick={() => setGoodbye(false)}>Keep it</button></div></div>
          : <button type="button" className="hub-reveal-bye" onClick={() => setGoodbye(true)}>Say goodbye</button>}
      </footer>}
    </div>
  </div>, document.body);
}
