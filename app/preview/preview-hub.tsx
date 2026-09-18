"use client";

import { changeConviction } from "@/lib/socialtrading/worldview";
import { useMemo, useState } from "react";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import { generatedAgentDescription, generatedAgentName } from "@/lib/socialtrading/agents/naming";
import { AgentsView } from "../(hub)/_hub/agents-view";
import type { HubState } from "@/lib/socialtrading/types";
import type { RunRecord } from "@/lib/socialtrading/runtime/types";
import type { CryptoAction, StateAction } from "../(hub)/_hub/client";
import { Hub } from "../(hub)/_hub/hub-shell";
import { HubProvider } from "../(hub)/_hub/hub-provider";
import { BeliefsView } from "../(hub)/_hub/worldview";
import { HomeView } from "../(hub)/_hub/home-view";
import { ExploreView } from "../(hub)/_hub/explore-view";
import { ActivityView } from "../(hub)/_hub/activity-view";
import { PlansView } from "../(hub)/_hub/plans-view";
import { ProfileView } from "../(hub)/_hub/profile-view";
import { AssetDetail } from "../(hub)/_hub/asset-detail";
import { PREVIEW_ACCOUNT, PREVIEW_ASSETS, PREVIEW_STATE, PREVIEW_TOKENS, PREVIEW_USER, PREVIEW_WALLET } from "./fixture";
import { catalogEntry, CATALOG_ENTRIES } from "@/lib/crypto/catalog";
import { chain, parseUnits } from "@/lib/crypto/chains";
import { latestChat, newChat } from "@/lib/socialtrading/chats";
import { buildGraph } from "@/lib/socialtrading/memory-graph";
import { treePlan } from "@/lib/socialtrading/belief-tree";
import type { JevAnswers } from "@/lib/socialtrading/jev-types";

import { ProfileFlow } from "../(hub)/social-trading";
import type { InvestingProfile } from "@/lib/socialtrading/profile";
import { previewHref } from "../(hub)/_hub/navigation";

export function PreviewExperience({ view, kind, id }: { view: string; kind?: string; id?: string }) {
  const [profile, setProfile] = useState<InvestingProfile>();
  const [attempt, setAttempt] = useState(0);
  const [onboarding, setOnboarding] = useState(view === "onboarding");
  return <div className={`preview-experience${onboarding ? " is-onboarding" : ""}`}>
    {!onboarding && <div className="container" style={{ position: "relative", zIndex: 60, padding: "12px 0 10px", display: "flex", gap: 16, alignItems: "center", background: "#fff" }}>
      <span className="socialtrading-caption">Preview · sample data</span>
      <button className="hub-inline-link" onClick={() => { setProfile(undefined); setAttempt(n => n + 1); setOnboarding(true); }}>Restart onboarding</button>
      <button className="hub-inline-link" onClick={() => setOnboarding(false)}>View hub</button>
      <a className="hub-inline-link" href="/preview?view=onboarding&onboarding=tree">Tree arm</a>
      <a className="hub-inline-link" href="/preview?view=onboarding&onboarding=inference">Inference arm</a>
      <a className="hub-inline-link" href="/preview?view=onboarding&onboarding=adaptive">Adaptive arm</a>
      <a className="hub-inline-link" href="/preview/onboarding-compare">Compare A/B</a>
    </div>}
    {onboarding ? <div className="landing-page socialtrading-page is-onboarding"><main className="container socialtrading-main"><div className="dashboard-theme socialtrading-flow"><ProfileFlow key={attempt} userId={PREVIEW_USER} name="Michael" persist={false} onComplete={value => { setProfile(value); setOnboarding(false); }} /></div></main></div>
      : <PreviewHub key={attempt} view={view === "onboarding" ? "home" : view} profile={profile} kind={kind} id={id} />}
  </div>;
}

const assets = Object.values(PREVIEW_ASSETS);
const baseApi = {
  market: async (_token: unknown, params: Record<string, string>) => ({
    assets: params.id ? assets.filter(a => a.id === params.id) : assets.filter(a => params.kind === "crypto" ? a.kind === "crypto" : params.kind === "trends" ? true : a.kind === "stock").filter(a => !params.q || `${a.symbol} ${a.name} ${a.themes.join(" ")}`.toLowerCase().includes(params.q.toLowerCase())),
  }),
  post: async () => ({ state: PREVIEW_STATE, account: PREVIEW_ACCOUNT }),
  load: async () => ({ state: PREVIEW_STATE, account: PREVIEW_ACCOUNT }),
};
const emptyChats = () => [newChat()];

const ROUTES: Record<string, string> = { beliefs: "/beliefs", thesis: "/beliefs", home: "/", fresh: "/", explore: "/explore", asset: "/explore/stock/VRT", trade: "/explore", activity: "/activity", agents: "/agents", profile: "/profile", "profile-fresh": "/profile", plans: "/plans" };

export function PreviewHub({ view, profile, kind, id }: { view: string; profile?: InvestingProfile; kind?: string; id?: string }) {
  const initial = useMemo<HubState>(() => ({ ...structuredClone(PREVIEW_STATE),
    ...(profile ? { profile, chats: emptyChats(), inferred: [], events: [], trades: [], signals: [], preferences: [], dislikes: [] }
      : (view === "beliefs" || view === "thesis") ? { trades: [
        ...PREVIEW_STATE.trades,
        ...[
          ['VRT', 'Vertiv Holdings', 1200, 'user', 12, 'AI needs more than chips. I bought the cooling and power infrastructure behind the next wave of data centers.'],
          ['CEG', 'Constellation Energy', 800, 'agent', 10, 'Your belief in growing AI demand connects to reliable, around-the-clock power. Nuclear generation gives this holding a different role from your technology exposure.'],
          ['VRT', 'Vertiv Holdings', 600, 'agent', 7, 'Added to an existing idea you care about: the physical infrastructure required to bring new AI capacity online.'],
          ['OKLO', 'Oklo Inc.', 250, 'user', 5, 'A small position in a longer-term belief: advanced nuclear could help meet the power needs of tomorrow.'],
          ['CEG', 'Constellation Energy', 400, 'user', 3, 'I wanted more exposure to established energy generation alongside the earlier-stage nuclear idea.'],
        ].map(([symbol, name, value, initiator, days, reasoning], i) => ({ id: `belief-demo-${i}`, asset: { id: String(symbol), symbol: String(symbol), name: String(name), kind: 'stock' as const }, side: 'buy' as const, value: Number(value), initiator: initiator as 'user' | 'agent', createdAt: new Date(Date.now() - Number(days) * 86400000).toISOString(), status: 'confirmed' as const, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, reasoning: String(reasoning), policy: { allowed: true, reason: 'Preview example', at: new Date().toISOString() } })),
      ] }
      : view === "fresh" ? { chats: emptyChats(), inferred: [], events: [], trades: [] }
      // A brand-new identity: no thesis, no themes, nothing learned, so the aura has only the seed to work with.
      : view === "profile-fresh" ? { profile: { ...structuredClone(PREVIEW_STATE.profile), thesis: "", themes: [], interests: [], completedAt: null }, chats: emptyChats(), inferred: [], events: [], trades: [], signals: [], preferences: [], dislikes: [] }
      : {}),
    agent: { ...defaultAgent(), name: "Michael’s agent", description: profile?.thesis ?? "AI inference and the power that feeds it.", enabled: true },
  }), [profile, view]);
  const api = useMemo(() => {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    const previewRuns: RunRecord[] = [
      { id: "r1", trigger: "cron", slot: minutesAgo(25), status: "succeeded", startedAt: minutesAgo(25), finishedAt: minutesAgo(24), summary: "Checked VRT, CEG and OKLO; small moves, nothing beyond what you already heard.", decision: { inspected: ["get_asset(VRT)", "get_asset(CEG)", "get_asset(OKLO)"], toolCalls: 3, notified: false, reason: "Nothing meaningful changed." }, error: null, notified: false },
      { id: "r2", trigger: "cron", slot: minutesAgo(85), status: "succeeded", startedAt: minutesAgo(85), finishedAt: minutesAgo(84), summary: "Nuclear news quiet; watching for the Oklo permit decision.", decision: { inspected: ["get_asset(OKLO)", "search_assets(nuclear)"], toolCalls: 2, notified: false, reason: "No new information." }, error: null, notified: false },
      { id: "r3", trigger: "cron", slot: minutesAgo(145), status: "failed", startedAt: minutesAgo(145), finishedAt: minutesAgo(144), summary: "The run failed.", decision: null, error: "Market data is busy. Try again shortly.", notified: false },
    ];
    const research: HubState = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("11111111-1111-4111-8111-111111111111"), name: "Crypto scout", description: "Early onchain themes, small positions.", enabled: true, notifications: { cadenceMinutes: 180, threshold: "high", maxPerDay: 2 } }, chats: emptyChats(), events: [], trades: [], inferred: [], signals: [], preferences: [], dislikes: [], profile: { ...structuredClone(PREVIEW_STATE.profile), thesis: "Stablecoin settlement and tokenized treasuries pull real volume onchain over the next two years.", themes: ["crypto"], interests: [], permission: "notify" } };
    /** Wake-ups are per agent, as in production. */
    const runsFor: Record<string, RunRecord[]> = { default: previewRuns, [research.agent!.id]: [{ ...previewRuns[1], id: "r-crypto", summary: "Stablecoin volume on Base climbed again; nothing worth waking you for.", decision: { inspected: ["trending_crypto()"], toolCalls: 1, notified: false, reason: "No new information." } }] };
    const states = new Map<string, HubState>([
      ["default", structuredClone(initial)],
      [research.agent!.id, research],
    ]);
    const account = () => ({ ...PREVIEW_ACCOUNT, usage: { agents: states.size, enabledAgents: [...states.values()].filter(s => s.agent?.enabled).length, chats: [...states.values()].reduce((n, s) => n + s.chats.length, 0) } });
    return { ...baseApi,
      agents: async () => ({ agents: [...states.values()].map(s => ({ ...s.agent!, themes: s.profile.themes })), account: account() }),
      load: async (_token: unknown, id = "default") => ({ state: states.get(id) ?? null, account: account() }),
      createAgent: async (_token: unknown, config: Parameters<typeof import("../(hub)/_hub/client").hubApi.createAgent>[1]) => {
        const id = crypto.randomUUID();
        const naming = config.profile ?? { ...structuredClone(PREVIEW_STATE.profile), thesis: config.thesis, themes: [] };
        const agent = { ...defaultAgent(id), name: generatedAgentName(naming, config.userName, id), description: generatedAgentDescription(naming) };
        if (states.size >= PREVIEW_ACCOUNT.limits.agents) throw new Error(`Your plan allows up to ${PREVIEW_ACCOUNT.limits.agents} agents. Delete an agent to create another.`);
        const state: HubState = { ...structuredClone(PREVIEW_STATE), agent, revision: 0, profile: config.profile ? structuredClone(config.profile) : { ...structuredClone(PREVIEW_STATE.profile), thesis: config.thesis, interests: [], themes: [], permission: "notify" }, chats: emptyChats(), events: [], trades: [], inferred: [], signals: [], preferences: [], dislikes: [], brokerage: { provider: "robinhood", connected: false } };
        states.set(agent.id, state); return { state, account: account() };
      },
      setAgentEnabled: async (_token: unknown, id: string, enabled: boolean) => {
        const running = [...states.values()].filter(s => s.agent?.enabled && s.agent.id !== id).length;
        if (enabled && running >= 2) throw new Error("Only 2 agents can run at once. Pause another agent first.");
        const state = states.get(id); if (state?.agent) state.agent = { ...state.agent, enabled };
        return { agents: [...states.values()].map(s => ({ ...s.agent!, themes: s.profile.themes })) };
      },
      deleteAgent: async (_token: unknown, id: string) => { if (states.size > 1) states.delete(id); return { agents: [...states.values()].map(s => ({ ...s.agent!, themes: s.profile.themes })) }; },
      runAgent: async (_token: unknown, id: string) => {
        const state = structuredClone(states.get(id)!);
        const at = new Date().toISOString();
        latestChat(state.chats).messages.push({ id: crypto.randomUUID(), role: "assistant", at, status: "done", via: "background", parts: [{ type: "text", text: "Vertiv is up 3% after raising guidance\n\nCooling demand from inference data centers is running ahead of supply, which is the bottleneck your thesis names. Worth a look, not a rush." }, { type: "asset", asset: PREVIEW_ASSETS.VRT }] });
        state.revision++; states.set(id, state);
        const run = { id: crypto.randomUUID(), trigger: "manual" as const, slot: null, status: "succeeded" as const, startedAt: at, finishedAt: at, summary: "Checked VRT, CEG, OKLO and nuclear news; reached out about Vertiv’s guidance raise.", decision: { inspected: ["get_asset(VRT)", "get_asset(CEG)", "get_asset(OKLO)"], toolCalls: 3, notified: true, relevance: "high" as const, reason: "Guidance raise on a watched name." }, error: null, notified: true };
        (runsFor[id] ??= []).unshift(run);
        return { outcome: { runId: run.id, status: "succeeded" as const, summary: run.summary, decision: run.decision, notification: { title: "Vertiv is up 3% after raising guidance", body: "", relevance: "high" as const } }, state, runs: [...runsFor[id]] };
      },
      runs: async (_token: unknown, id: string) => ({ runs: [...(runsFor[id] ?? [])] }),
      // Preview never reaches Jev, and the tree draws nothing but what a model
      // returned — so preview answers in Jev's shape, from the strengths the
      // sample worldview already carries. Sample data, like everything here.
      beliefs: async (_token: unknown, frameId: string, id = "default") => {
        const state = states.get(id) ?? initial;
        const frames = buildGraph(state);
        const frame = frames.find(f => f.id === frameId) ?? frames.at(-1);
        const plan = frame ? treePlan(frame, state.profile.themes ?? []) : null;
        const answers: JevAnswers = {};
        for (const [key, question] of Object.entries(plan?.questions ?? {})) {
          const belief = plan!.beliefs[Number(key.slice(1))];
          if (question.type === "choice") {
            const options = Object.keys(question.criteria);
            const chosen = belief?.themes.find(t => options.includes(t)) ?? options[options.length - 1];
            answers[key] = { type: "choice", choice: chosen, probabilities: { [chosen]: .78 }, confidence: .78 };
          } else if (question.type === "score") {
            answers[key] = { type: "score", score: key.startsWith("c") ? Math.max(0, Math.min(4, Math.round((belief?.strength ?? .5) * 4))) : 3, legend: {}, probabilities: {}, confidence: .74 };
          }
        }
        return { frameId, answers, source: "jev" as const, model: "typesafe/jev-1.13" };
      },
      wallets: async () => ({ wallets: [PREVIEW_WALLET] }),
      searchTokens: async (_token: unknown, q: string) => ({ tokens: PREVIEW_TOKENS.filter(t => `${t.symbol} ${t.name}`.toLowerCase().includes(q.toLowerCase())) }),
      crypto: async (_token: unknown, _revision: number, action: CryptoAction, id = "default") => {
        const state = structuredClone(states.get(id)!);
        if (action.action === "holdings") {
          // Preview: USDC that landed on Ethereum instead of Base, the classic case.
          const owned = CATALOG_ENTRIES[0];
          return { complete: true, holdings: [{ chainId: 8453, chainName: "Base", wallet: PREVIEW_WALLET, token: owned.contracts[8453]!, symbol: owned.symbol, decimals: owned.decimals, balance: "50000000", display: "0.5", kind: "token" as const }, { chainId: 8453, chainName: "Base", wallet: PREVIEW_WALLET, token: chain(8453).usdc, symbol: "USDC", decimals: 6, balance: "4250000", display: "4.25", kind: "usdc" as const }] };
        }
        if (action.action === "withdraw") throw new Error("Preview does not send transactions. Connect a live wallet to move funds.");
        if (action.action === "purchase_route") {
          // Preview funds sit on Base, so the panel shows a resolved same-chain route.
          const chosen = { chainId: 8453, wallet: PREVIEW_WALLET, balance: "500000000", reserve: "20000", status: "same_chain" as const };
          return { route: { chosen, candidates: [chosen] } };
        }
        if (action.action === "propose") {
          if (action.destinationChainId && action.destinationChainId !== action.chainId) throw new Error("Cross-network execution requires a connected live wallet. Preview does not submit transactions.");
          const trade: HubState["trades"][number] = { ...structuredClone(PREVIEW_STATE.trades[1]), id: crypto.randomUUID(), initiator: "user", createdAt: new Date().toISOString(), status: "reserved", reasoning: action.note ?? "Placed by you.", policy: { allowed: true, reason: "You placed this yourself. Your agent’s mode and limits apply only to trades it proposes.", at: new Date().toISOString() } };
          const selling = action.tokenOut === chain(action.chainId).usdc;
          const input = catalogEntry(action.chainId, action.tokenIn), output = catalogEntry(action.chainId, action.tokenOut);
          trade.side = selling ? "sell" : "buy";
          trade.crypto!.request = { chainId: action.chainId, wallet: action.wallet, tokenIn: action.tokenIn, tokenOut: action.tokenOut, amount: parseUnits(action.amount, input?.decimals ?? 6), slippageBps: action.slippageBps ?? 50 };
          if (selling && input) {
            trade.asset = { id: `${action.chainId}:${action.tokenIn}`, symbol: input.symbol, name: input.name, kind: "crypto" };
            trade.crypto!.display = { tokenIn: { symbol: input.symbol, decimals: input.decimals }, tokenOut: { symbol: "USDC", decimals: 6 } };
            trade.crypto!.outputAmount = "100000000"; trade.crypto!.minimumOutput = "99500000"; trade.value = 100;
          } else if (output) trade.crypto!.display = { tokenIn: { symbol: "USDC", decimals: 6 }, tokenOut: { symbol: output.symbol, decimals: output.decimals } };
          trade.crypto!.detail = "Preview: review and sign with your wallet when you’re ready.";
          state.trades.push(trade); state.revision++; states.set(id, state); return { state, tradeId: trade.id };
        }
        const trade = state.trades.find(t => t.id === action.tradeId);
        if (trade?.crypto && action.action === "reject") { trade.status = "rejected"; trade.crypto.detail = "Declined. Nothing was sent to your wallet."; }
        state.revision++; states.set(id, state); return { state };
      },
      post: async (_token: unknown, _revision: number, action: StateAction, id = "default") => {
        const state = structuredClone(states.get(id)!);
        if (action.action === "conviction") changeConviction(state, action);
        if (action.action === "agent") {
          if (action.thesis !== undefined) state.profile.thesis = action.thesis;
          if (action.interests) state.profile.interests = action.interests;
          if (action.permission) state.profile.permission = action.permission;
          if (action.limits) state.profile.limits = action.limits;
        }
        if (action.action === "profile") { state.profile = action.profile; state.dislikes = action.dislikes; state.preferences = action.preferences; }
        if (action.action === "signal") {
          state.signals.push({ id: crypto.randomUUID(), action: action.signal, target: action.target, at: new Date().toISOString() });
          if (action.signal === "watched" && !state.profile.interests.some(i => i.id === action.target)) state.profile.interests.push({ id: action.target, name: action.name ?? action.target, symbol: action.symbol ?? action.target, kind: action.kind ?? "stock" });
          if (action.signal === "removed") state.profile.interests = state.profile.interests.filter(i => i.id !== action.target && i.symbol !== action.target);
        }
        let chatId: string | undefined;
        if (action.action === "chat") {
          if (action.op === "create") { if (account().usage.chats >= PREVIEW_ACCOUNT.limits.chats) throw new Error(`Your plan allows up to ${PREVIEW_ACCOUNT.limits.chats} chats. Delete an old chat to start a new one.`); const chat = newChat(); state.chats.push(chat); chatId = chat.id; }
          else { state.chats = state.chats.filter(c => c.id !== action.chatId); if (!state.chats.length) state.chats.push(newChat()); }
        }
        state.revision++; states.set(id, state); return { state, account: account(), chatId };
      },
    };
  }, [initial]);
  const content = (view === "beliefs" || view === "thesis") ? <BeliefsView /> : view === "agents" ? <AgentsView /> : view === "explore" ? <ExploreView /> : view === "trade" ? <ExploreView /> : view === "activity" ? <ActivityView /> : view === "plans" ? <PlansView /> : view === "profile" || view === "profile-fresh" ? <ProfileView /> : view === "asset" ? <AssetDetail kind={kind === "crypto" ? "crypto" : "stock"} id={id ?? "VRT"} /> : <HomeView />;
  return <HubProvider userId={PREVIEW_USER} name="Michael" initialAccount={PREVIEW_ACCOUNT} initial={initial} api={api} chatStream={async () => { throw new Error("Chat replies are unavailable in preview. Explore the sample conversations and hub views."); }}><Hub path={ROUTES[view] ?? "/"} resolveHref={previewHref}>{content}</Hub></HubProvider>;
}
