import type { AgentConfig, NotificationThreshold } from "../agents/config";
import type { ToolSchema } from "../agents/registry";
import type { HubState, MessagePart } from "../types";

/** What woke the agent. The runtime behaves the same; only the ledger differs. */
export type RunTrigger = "cron" | "manual" | "chat" | "event";
export type RunStatus = "running" | "succeeded" | "failed" | "skipped";
export type Relevance = NotificationThreshold;

export type RunJob = {
  userId: string;
  agentId: string;
  trigger: RunTrigger;
  /** Idempotency key for scheduled runs (the slot start). Null for ad-hoc triggers. */
  slot: string | null;
};

export type RunDecision = {
  /** Tools the agent chose to call, with the argument that identifies the lookup. */
  inspected: string[];
  toolCalls: number;
  notified: boolean;
  relevance?: Relevance;
  /** Why the agent did or did not reach out, in its own words. */
  reason: string;
  /** Set when the agent wanted to notify but policy stopped it. */
  suppressed?: string;
};

export type RunOutcome = {
  runId: string | null;
  status: Exclude<RunStatus, "running">;
  summary: string;
  decision?: RunDecision;
  error?: string;
  notification?: { title: string; body: string; relevance: Relevance };
};

export type RunRecord = {
  id: string;
  trigger: RunTrigger;
  slot: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  decision: RunDecision | null;
  error: string | null;
  notified: boolean;
};

/** What the agent carries between wake-ups. Small by design; the profile and history live in HubState. */
export type AgentMemory = {
  notes: string[];
  /** Last observed quote per asset, so the next run can see what moved. */
  watched: Record<string, { symbol: string; kind: "stock" | "crypto"; price: number | null; change: number | null; at: string }>;
  lastSummary?: string;
  lastRunAt?: string;
  lastNotifiedAt?: string;
};
export const emptyMemory = (): AgentMemory => ({ notes: [], watched: {} });

export type DueAgent = { userId: string; agentId: string; agent: AgentConfig; memory: AgentMemory; lastStartedAt: string | null };

export type NotificationInput = {
  userId: string; agentId: string; runId: string | null;
  title: string; body: string; relevance: Relevance; dedupeKey: string | null; parts: MessagePart[];
};

/** Persistence the runtime needs. Supabase in production; in-memory in tests. */
export interface RuntimeStore {
  dueAgents(): Promise<DueAgent[]>;
  /** Returns the run id, or null when the agent is already running or the slot already ran. */
  claimRun(job: RunJob, leaseSeconds: number): Promise<string | null>;
  finishRun(runId: string, result: { status: "succeeded" | "failed"; summary: string; decision?: RunDecision; error?: string; notified: boolean }): Promise<void>;
  loadState(userId: string, agentId: string): Promise<HubState | null>;
  /** Compare-and-swap on `state.revision`; rejects with a 409-style error on conflict. */
  saveState(userId: string, state: HubState): Promise<HubState>;
  readMemory(userId: string, agentId: string): Promise<AgentMemory>;
  writeMemory(userId: string, agentId: string, memory: AgentMemory): Promise<void>;
  notificationsSince(userId: string, agentId: string, since: Date): Promise<number>;
  insertNotification(input: NotificationInput): Promise<"inserted" | "duplicate">;
  recentRuns(userId: string, agentId: string, limit: number): Promise<RunRecord[]>;
}

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ModelToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };
export type ModelToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** One non-streaming chat completion with tool calling. `usage` is what the provider reported, for the credits ledger. */
export interface ModelClient {
  complete(input: { messages: ModelMessage[]; tools: ToolSchema[]; toolChoice: "auto" | "none"; signal?: AbortSignal;
    /** Output budget. Defaults to the agent loop's; a caller that returns one
     * small object should ask for less, so a thin balance still affords it. */
    maxTokens?: number }): Promise<{ content: string; toolCalls: ModelToolCall[]; usage?: import("../credits").ModelUsage }>;
}
