"use client";
import { rememberLoadingAgent } from "../../_components/loading-agent-identity";
import type { InvestingProfile } from "@/lib/socialtrading/profile";
import { agentSelectionKey, type AgentConfig } from "@/lib/socialtrading/agents/config";

import { usePrivy } from "@privy-io/react-auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Asset, Chat, ChatEvent, HubState, Message, MessagePart, ProfileChange, SignalAction } from "@/lib/socialtrading/types";
import { announcePresence } from "@/lib/socialtrading/presence";
import { latestChat } from "@/lib/socialtrading/chats";
import type { AccountSummary } from "@/lib/socialtrading/plans";
import { hubApi, HubRequestError, streamChat, type CryptoAction, type CryptoResult, type StateAction } from "./client";
import type { RunOutcome, RunRecord } from "@/lib/socialtrading/runtime/types";
import type { JevAnswers } from "@/lib/socialtrading/jev-types";
import { useAccountSummary } from "./account-state";

export type HubContextValue = {
  agents: AgentConfig[];
  switchAgent: (id: string) => Promise<void>;
  createAgent: (input: { thesis: string; profile?: InvestingProfile; userName?: string }) => Promise<boolean>;
  refreshAgents: () => Promise<void>;
  /** Scheduled-run toggle. Works on any agent, not only the selected one. */
  setAgentEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  /** Removes an agent; when it was selected, the hub moves to the first remaining agent. */
  deleteAgent: (id: string) => Promise<boolean>;
  /** Wakes an agent now through the same runtime the cron uses. Defaults to the selected agent. */
  runNow: (agentId?: string) => Promise<RunOutcome | null>;
  loadRuns: () => Promise<RunRecord[]>;
  /** Confidence scores for one chapter of the worldview, from the Jev decision model. Null when it could not be reached, so the view falls back to its own arithmetic. */
  scoreBeliefs: (frameId: string) => Promise<JevAnswers | null>;
  /** Reads another agent's workspace and recent wake-ups without switching to it. */
  inspectAgent: (id: string) => Promise<{ state: HubState | null; runs: RunRecord[] }>;
  userId: string; name?: string;
  state: HubState;
  /** The signed-in user's plan, credits, and cross-agent usage. Null until the first server response carries it. */
  account: AccountSummary | null;
  refreshAccount: () => Promise<void>;
  /** Chat threads of the selected agent and the one the user is in. */
  chats: Chat[];
  chat: Chat;
  selectChat: (id: string) => void;
  newChat: () => Promise<boolean>;
  deleteChat: (id: string) => Promise<boolean>;
  /** Messages of the active chat plus any in-flight exchange. */
  messages: Message[];
  busy: boolean;
  error: string | null;
  clearError: () => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  mutate: (action: StateAction) => Promise<HubState | null>;
  /** Onchain swap actions. Throws on failure; a stale revision is refreshed and retried once. Does not lock the hub, so the user can keep talking while a wallet prompt is open. */
  crypto: (action: CryptoAction) => Promise<CryptoResult>;
  /** Wallets Privy has verified for this user, from the server. */
  wallets: () => Promise<string[]>;
  /** Buyable tokens (crypto and tokenized stocks) on supported chains. */
  searchTokens: (q: string) => Promise<import("@/lib/crypto/search").TokenMatch[]>;
  signal: (action: SignalAction, asset: Pick<Asset, "id" | "symbol" | "name" | "kind" | "themes"> | string) => Promise<boolean>;
  market: (params: Record<string, string>) => Promise<Asset[]>;
  draft: string; setDraft: (text: string) => void;
  /** Most recent profile change announced by the agent, for card highlights. */
  lastChange: { changes: ProfileChange[]; at: number } | null;
  reload: () => Promise<void>;
};

const HubContext = createContext<HubContextValue | null>(null);
export function useHub() {
  const value = useContext(HubContext);
  if (!value) throw new Error("useHub must be used inside HubProvider");
  return value;
}

export function reduceChatEvent(message: Message, event: ChatEvent): Message {
  if (event.type === "text") {
    const parts = [...message.parts], last = parts.at(-1);
    if (last?.type === "text") parts[parts.length - 1] = { type: "text", text: last.text + event.text };
    else parts.push({ type: "text", text: event.text });
    return { ...message, parts };
  }
  if (event.type === "part") return { ...message, parts: [...message.parts, event.part as MessagePart] };
  if (event.type === "message") return { ...message, id: event.id, at: event.at };
  if (event.type === "done") return { ...message, status: "done" };
  if (event.type === "error") return { ...message, status: "error", parts: [...message.parts, { type: "notice", text: event.message }] };
  return message;
}

const chatKey = (userId: string, agentId: string) => `rubicon:active-chat:${encodeURIComponent(userId)}:${agentId}`;
const rememberedChat = (userId: string, state: HubState) => {
  let stored: string | null = null;
  try { stored = localStorage.getItem(chatKey(userId, state.agent?.id ?? "default")); } catch { /* storage unavailable */ }
  return (stored && state.chats.find(c => c.id === stored)) ? stored : latestChat(state.chats).id;
};

export function HubProvider({ userId, name, initial, initialAccount = null, api: overrides, chatStream = streamChat, children }: {
  userId: string; name?: string; initial: HubState; initialAccount?: AccountSummary | null; children: ReactNode;
  /** Preview/test seam: replace individual API calls. Production passes nothing. */
  api?: Partial<typeof hubApi>;
  chatStream?: typeof streamChat;
}) {
  const { getAccessToken } = usePrivy();
  const api = useMemo(() => ({ ...hubApi, ...overrides }), [overrides]);
  const token = useCallback(() => getAccessToken(), [getAccessToken]);
  const [state, setState] = useState(initial);
  const [account, setAccount] = useAccountSummary(userId, initialAccount);
  const [agents, setAgents] = useState<AgentConfig[]>(initial.agent ? [initial.agent] : []);
  const activeId = useRef(initial.agent?.id ?? "default");
  const [activeChatId, setActiveChatId] = useState(() => rememberedChat(userId, initial));
  const activeChat = useRef(activeChatId);
  useEffect(() => { activeChat.current = activeChatId; }, [activeChatId]);
  const generation = useRef(0);
  const operation = useRef(false);
  const [pending, setPending] = useState<{ chatId: string; user: Message; assistant: Message } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [lastChange, setLastChange] = useState<HubContextValue["lastChange"]>(null);
  const abort = useRef<AbortController | null>(null);
  const revision = useRef(initial.revision);
  useEffect(() => { revision.current = state.revision; }, [state.revision]);
  useEffect(() => { rememberLoadingAgent(userId, state, agents); }, [userId, state, agents]);
  useEffect(() => () => abort.current?.abort(), []);

  /** Responses may carry the account beside the state; take it whenever it appears. */
  const absorb = useCallback(<T extends { account?: AccountSummary }>(result: T) => { if (result.account) setAccount(result.account); return result; }, []);
  const refreshAccount = useCallback(async () => {
    const epoch = generation.current;
    try {
      const result = absorb(await api.load(token, activeId.current));
      if (epoch === generation.current && result.state) {
        const fresh = result.state;
        setState(current => fresh.revision > current.revision ? fresh : current);
      }
    } catch { /* the next state response refreshes it */ }
  }, [api, token, absorb]);

  // Background checks spend credits even while this page is idle.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void refreshAccount(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshAccount]);

  const reload = useCallback(async () => {
    try { const { state: fresh } = absorb(await api.load(token, activeId.current)); if (fresh && (fresh.agent?.id ?? "default") === activeId.current) { revision.current = fresh.revision; setState(fresh); } }
    catch (e) { setError(e instanceof Error ? e.message : "Your workspace could not be refreshed."); }
  }, [token, api, absorb]);

  const refreshAgents = useCallback(async () => {
    try { setAgents(absorb(await api.agents(token)).agents); }
    catch (e) { setError(e instanceof Error ? e.message : "Your agents could not be loaded."); }
  }, [api, token, absorb]);
  const activate = useCallback((next: HubState) => {
    generation.current++;
    activeId.current = next.agent?.id ?? "default";
    revision.current = next.revision;
    setState(next); setPending(null); setDraft(""); setLastChange(null); setError(null);
    setActiveChatId(rememberedChat(userId, next));
    try { localStorage.setItem(agentSelectionKey(userId), activeId.current); } catch { /* storage unavailable */ }
  }, [userId]);
  const switchAgent = useCallback(async (id: string) => {
    if (operation.current || busy || id === activeId.current) return;
    operation.current = true; setBusy(true);
    try {
      const { state: next } = absorb(await api.load(token, id));
      if (!next) throw new Error("Agent not found.");
      activate(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not switch agents."); }
    finally { operation.current = false; setBusy(false); }
  }, [api, token, busy, activate, absorb]);
  const createAgent = useCallback(async (input: { thesis: string; profile?: InvestingProfile; userName?: string }) => {
    if (operation.current || busy) return false;
    operation.current = true; setBusy(true);
    try { const { state: next } = absorb(await api.createAgent(token, input)); activate(next); await refreshAgents(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create agent."); return false; }
    finally { operation.current = false; setBusy(false); }
  }, [api, token, busy, activate, refreshAgents, absorb]);

  const setAgentEnabled = useCallback(async (id: string, enabled: boolean) => {
    if (operation.current || busy) return false;
    operation.current = true; setBusy(true);
    try {
      const { agents: next } = absorb(await api.setAgentEnabled(token, id, enabled));
      setAgents(next);
      if (id === activeId.current) setState(current => current.agent ? { ...current, agent: { ...current.agent, enabled } } : current);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update this agent."); return false; }
    finally { operation.current = false; setBusy(false); }
  }, [api, token, busy, absorb]);
  const deleteAgent = useCallback(async (id: string) => {
    if (operation.current || busy) return false;
    operation.current = true; setBusy(true);
    try {
      const { agents: remaining } = absorb(await api.deleteAgent(token, id));
      setAgents(remaining);
      if (id === activeId.current) {
        const next = remaining[0];
        if (!next) throw new Error("No agents left.");
        const { state: loaded } = absorb(await api.load(token, next.id));
        if (!loaded) throw new Error("Agent not found.");
        activate(loaded);
      }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete this agent."); return false; }
    finally { operation.current = false; setBusy(false); }
  }, [api, token, busy, activate, absorb]);
  const runNow = useCallback(async (agentId?: string) => {
    if (operation.current || busy) return null;
    operation.current = true; setBusy(true);
    const epoch = generation.current, target = agentId ?? activeId.current;
    try {
      const { outcome, state: next } = absorb(await api.runAgent(token, target));
      if (epoch === generation.current && next && target === activeId.current) { revision.current = next.revision; setState(next); }
      return outcome;
    } catch (e) { setError(e instanceof Error ? e.message : "The agent could not run right now."); return null; }
    finally { operation.current = false; setBusy(false); }
  }, [api, token, busy, absorb]);
  const loadRuns = useCallback(async () => {
    try { return (await api.runs(token, activeId.current)).runs; } catch { return []; }
  }, [api, token]);
  // Advisory and never blocking: a chapter that cannot be scored is drawn from
  // the strengths already recorded rather than not drawn at all.
  const scoreBeliefs = useCallback(async (frameId: string) => {
    try {
      const result = await api.beliefs(token, frameId, activeId.current);
      return result.source === "jev" ? result.answers : null;
    } catch { return null; }
  }, [api, token]);
  const inspectAgent = useCallback(async (id: string) => {
    const [loaded, runs] = await Promise.all([api.load(token, id).catch(() => ({ state: null })), api.runs(token, id).then(r => r.runs).catch(() => [] as RunRecord[])]);
    return { state: loaded.state, runs };
  }, [api, token]);

  const post = useCallback(async (action: StateAction) => {
    if (operation.current || busy) return null;
    operation.current = true; setBusy(true);
    const epoch = generation.current;
    try {
      const result = absorb(await api.post(token, revision.current, action, activeId.current));
      if (epoch !== generation.current) return null;
      revision.current = result.state.revision; setState(result.state);
      if (action.action === "agent") void refreshAgents();
      return result;
    } catch (e) {
      if (e instanceof HubRequestError && e.status === 409) { await reload(); setError("Your workspace changed in another tab. It has been refreshed; try again."); }
      else setError(e instanceof Error ? e.message : "Your change could not be saved.");
      return null;
    } finally { operation.current = false; setBusy(false); }
  }, [token, reload, api, busy, refreshAgents, absorb]);
  const mutate = useCallback(async (action: StateAction) => (await post(action))?.state ?? null, [post]);

  const selectChat = useCallback((id: string) => {
    setActiveChatId(id); setPending(null); setLastChange(null); setDraft("");
    try { localStorage.setItem(chatKey(userId, activeId.current), id); } catch { /* storage unavailable */ }
  }, [userId]);
  const newChat = useCallback(async () => {
    const result = await post({ action: "chat", op: "create" });
    if (!result) return false;
    selectChat(result.chatId ?? latestChat(result.state.chats).id);
    return true;
  }, [post, selectChat]);
  const deleteChat = useCallback(async (id: string) => {
    const result = await post({ action: "chat", op: "delete", chatId: id });
    if (!result) return false;
    if (id === activeChat.current || !result.state.chats.some(c => c.id === activeChat.current)) selectChat(latestChat(result.state.chats).id);
    return true;
  }, [post, selectChat]);

  const crypto = useCallback(async (action: CryptoAction) => {
    const epoch = generation.current;
    const run = () => api.crypto(token, revision.current, action, activeId.current);
    let result: CryptoResult;
    try { result = await run(); }
    catch (e) { if (e instanceof HubRequestError && e.status === 409) { await reload(); result = await run(); } else throw e; }
    // A read-only answer carries no workspace, and adopting a stale one would
    // quietly discard whatever the person changed while it was in flight.
    if (result.state && epoch === generation.current) { revision.current = result.state.revision; setState(result.state); }
    return result;
  }, [api, token, reload]);
  const wallets = useCallback(async () => (await api.wallets(token)).wallets, [api, token]);
  const searchTokens = useCallback(async (q: string) => (await api.searchTokens(token, q)).tokens, [api, token]);

  const signal = useCallback(async (action: SignalAction, asset: Pick<Asset, "id" | "symbol" | "name" | "kind" | "themes"> | string) => {
    if (operation.current || busy) return false;
    const epoch = generation.current;
    const body: StateAction = typeof asset === "string"
      ? { action: "signal", signal: action, target: asset }
      : { action: "signal", signal: action, target: asset.kind === "crypto" ? asset.id : asset.symbol, kind: asset.kind, symbol: asset.symbol, name: asset.name, themes: asset.themes };
    try {
      let result;
      try { result = await api.post(token, revision.current, body, activeId.current); }
      catch (e) {
        if (!(e instanceof HubRequestError) || e.status !== 409) throw e;
        await reload();
        if (epoch !== generation.current) return false;
        result = await api.post(token, revision.current, body, activeId.current);
      }
      absorb(result);
      if (epoch === generation.current) {
        setState(current => result.state.revision >= current.revision ? result.state : current);
        if (action === "opened" && typeof asset !== "string") {
          const target = asset.kind === "crypto" ? asset.id : asset.symbol;
          const visits = result.state.signals.filter(s => s.action === "opened" && s.target === target && Date.parse(s.at) > Date.now() - 7 * 86400_000);
          if (visits.length >= 3) announcePresence({ kind: "revisit", asset });
        }
      }
      return true;
    } catch (e) {
      if (epoch === generation.current) setError(e instanceof Error ? e.message : "Couldn’t save that. Try again.");
      return false;
    }
  }, [token, reload, api, busy, absorb]);

  const market = useCallback(async (params: Record<string, string>) => (await api.market(token, { ...params, agentId: activeId.current })).assets, [token, api]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || operation.current) return;
    operation.current = true;
    const at = new Date().toISOString(), chatId = activeChat.current;
    let assistant: Message = { id: `pending-assistant`, role: "assistant", at, parts: [], status: "streaming" };
    const user: Message = { id: `pending-user`, role: "user", at, parts: [{ type: "text", text: trimmed }], status: "done" };
    setPending({ chatId, user, assistant }); setBusy(true); setError(null); setDraft("");
    const controller = new AbortController(); abort.current = controller;
    try {
      await chatStream(token, { text: trimmed, revision: revision.current, agentId: activeId.current, chatId }, event => {
        if (event.type === "account") { setAccount(event.account); return; }
        if (event.type === "state") {
          const changes = event.state.chats.find(c => c.id === chatId)?.messages.at(-1)?.parts.flatMap(p => p.type === "profile_update" ? p.changes : []) ?? [];
          if (changes.length) setLastChange({ changes, at: Date.now() });
          setState(event.state);
          return;
        }
        assistant = reduceChatEvent(assistant, event);
        setPending({ chatId, user, assistant });
      }, controller.signal);
      setPending(null);
    } catch (e) {
      if (controller.signal.aborted) { setPending(null); return; }
      const message = e instanceof Error ? e.message : "Your agent is unavailable right now.";
      setPending({ chatId, user, assistant: { ...assistant, status: "error", parts: [...assistant.parts, { type: "notice", text: message }] } });
      if (e instanceof HubRequestError && e.status === 409) void reload();
      if (e instanceof HubRequestError && e.code === "credits") void refreshAccount();
    } finally {
      setBusy(false); operation.current = false; abort.current = null;
    }
  }, [busy, token, reload, refreshAccount, chatStream]);

  const stop = useCallback(() => { abort.current?.abort(); }, []);

  const chat = useMemo(() => state.chats.find(c => c.id === activeChatId) ?? latestChat(state.chats), [state.chats, activeChatId]);
  const messages = useMemo(() => {
    if (!pending || pending.chatId !== chat.id) return chat.messages;
    // Once the server has persisted the exchange, the pending copy is redundant.
    const persisted = chat.messages.some(m => m.id === pending.assistant.id);
    return persisted ? chat.messages : [...chat.messages, pending.user, pending.assistant];
  }, [chat, pending]);

  const value = useMemo<HubContextValue>(() => ({
    agents, switchAgent, createAgent, refreshAgents, setAgentEnabled, deleteAgent, runNow, loadRuns, scoreBeliefs, inspectAgent, userId, name, state, account, refreshAccount,
    chats: state.chats, chat, selectChat, newChat, deleteChat, messages, busy, error, clearError: () => setError(null), send, stop, mutate, crypto, wallets, searchTokens, signal, market, draft, setDraft, lastChange, reload,
  }), [agents, switchAgent, createAgent, refreshAgents, setAgentEnabled, deleteAgent, runNow, loadRuns, scoreBeliefs, inspectAgent, userId, name, state, account, refreshAccount, chat, selectChat, newChat, deleteChat, messages, busy, error, send, stop, mutate, crypto, wallets, searchTokens, signal, market, draft, lastChange, reload]);

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}
