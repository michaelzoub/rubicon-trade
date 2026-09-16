import type { InvestingProfile } from "@/lib/socialtrading/profile";
import type { AgentConfig } from "@/lib/socialtrading/agents/config";
import type { Asset, ChatEvent, HubState, SignalAction } from "@/lib/socialtrading/types";
import type { SwapBatch, Transaction } from "@/lib/crypto/types";
import type { TokenMatch } from "@/lib/crypto/search";
import type { RunOutcome, RunRecord } from "@/lib/socialtrading/runtime/types";
import type { AccountSummary, LimitKey } from "@/lib/socialtrading/plans";

/** `code` distinguishes a plan limit (422) or empty credits (402) from a transient failure, so the UI can explain rather than retry. */
export type HubErrorCode = "limit" | "credits";
export class HubRequestError extends Error {
  constructor(public status: number, message: string, public code?: HubErrorCode, public limit?: LimitKey, public remedy?: string) { super(message); }
}

type Token = () => Promise<string | null>;

async function request<T>(token: Token, url: string, init?: RequestInit): Promise<T> {
  const access = await token();
  if (!access) throw new HubRequestError(401, "Sign in to continue.");
  const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${access}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new HubRequestError(response.status, body.error ?? "This request could not be completed.", body.code, body.limit, body.remedy);
  return body as T;
}

export type StateAction =
  | { action: "conviction"; id: string; text: string; strength: number; remove?: boolean }
  /** The small set of choices people explicitly control for an agent. */
  | { action: "agent"; thesis?: string; interests?: HubState["profile"]["interests"]; permission?: HubState["profile"]["permission"]; limits?: HubState["profile"]["limits"] }
  | { action: "initialize"; profile: unknown; userName?: string }
  | { action: "profile"; profile: HubState["profile"]; dislikes: string[]; preferences: string[] }
  | { action: "signal"; signal: SignalAction; target: string; kind?: Asset["kind"]; symbol?: string; name?: string; themes?: string[] }
  | { action: "forget"; target: string }
  | { action: "trade"; tradeId: string; decision: "approved" | "rejected" }
  /** Chat threads. Creation is capped per plan across every agent; deleting the last chat leaves an empty one. */
  | { action: "chat"; op: "create" }
  | { action: "chat"; op: "delete"; chatId: string };

/** Onchain swap actions. `propose` is the user's own swap; the rest drive a proposal through signing and verification. */
export type CryptoAction =
  | { action: "propose"; chainId: number; wallet: string; tokenIn: string; tokenOut: string; amount: string; slippageBps?: number; note?: string }
  | { action: "prepare" | "reject" | "status"; tradeId: string }
  | { action: "submitted"; tradeId: string; hash: string; userOpHash?: string };
export type CryptoResult = { state: HubState; tradeId?: string; batch?: SwapBatch; transaction?: Transaction; step?: "approval" | "swap"; expiresAt?: number };

export const hubApi = {
  wallets: (token: Token) => request<{ wallets: string[] }>(token, "/api/trade/crypto", { cache: "no-store" }),
  searchTokens: (token: Token, q: string) => request<{ tokens: TokenMatch[] }>(token, `/api/trade/crypto?${new URLSearchParams({ q })}`, { cache: "no-store" }),
  crypto: (token: Token, revision: number, body: CryptoAction, agentId = "default") => request<CryptoResult>(token, "/api/trade/crypto", { method: "POST", body: JSON.stringify({ ...body, revision, agentId }) }),
  agents: (token: Token) => request<{ agents: AgentConfig[]; account?: AccountSummary }>(token, "/api/trade/agents", { cache: "no-store" }),
  createAgent: (token: Token, input: { thesis: string; profile?: InvestingProfile; userName?: string }) => request<{ state: HubState; account?: AccountSummary }>(token, "/api/trade/agents", { method: "POST", body: JSON.stringify(input) }),
  setAgentEnabled: (token: Token, agentId: string, enabled: boolean) => request<{ agents: AgentConfig[]; account?: AccountSummary }>(token, "/api/trade/agents", { method: "PATCH", body: JSON.stringify({ agentId, enabled }) }),
  deleteAgent: (token: Token, agentId: string) => request<{ agents: AgentConfig[]; account?: AccountSummary }>(token, `/api/trade/agents?${new URLSearchParams({ agentId })}`, { method: "DELETE" }),
  runAgent: (token: Token, agentId: string) => request<{ outcome: RunOutcome; state: HubState | null; runs: RunRecord[]; account?: AccountSummary }>(token, "/api/trade/agents/run", { method: "POST", body: JSON.stringify({ agentId }) }),
  runs: (token: Token, agentId: string) => request<{ runs: RunRecord[] }>(token, `/api/trade/agents/runs?${new URLSearchParams({ agentId })}`, { cache: "no-store" }),
  load: (token: Token, agentId = "default") => request<{ state: HubState | null; account?: AccountSummary }>(token, `/api/trade/state?${new URLSearchParams({ agentId })}`, { cache: "no-store" }),
  post: (token: Token, revision: number, body: StateAction, agentId = "default") => request<{ state: HubState; account?: AccountSummary; chatId?: string }>(token, "/api/trade/state", { method: "POST", body: JSON.stringify({ ...body, revision, agentId }) }),
  market: (token: Token, params: Record<string, string>) => request<{ assets: Asset[] }>(token, `/api/trade/market?${new URLSearchParams(params)}`),
};

/** Incremental server-sent-events parser. Feed raw chunks, receive complete events. */
export function sseParser(onEvent: (event: ChatEvent) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        const data = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
        if (!data) continue;
        try { onEvent(JSON.parse(data) as ChatEvent); } catch { /* ignore malformed frame */ }
      }
    },
  };
}

export async function streamChat(token: Token, body: { text: string; revision: number; agentId?: string; chatId?: string }, onEvent: (event: ChatEvent) => void, signal?: AbortSignal) {
  const access = await token();
  if (!access) throw new HubRequestError(401, "Sign in to continue.");
  const response = await fetch("/api/trade/chat", { method: "POST", signal, headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok || !response.body) {
    const error = await response.json().catch(() => ({}));
    throw new HubRequestError(response.status, error.error ?? "Your agent is unavailable right now.", error.code, error.limit, error.remedy);
  }
  const reader = response.body.getReader(), decoder = new TextDecoder(), parser = sseParser(onEvent);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
}
