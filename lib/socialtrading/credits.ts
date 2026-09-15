import { MICROS_PER_USD } from "./plans";
import type { ModelClient } from "./runtime/types";

/** Who a model call is billed to and what it belonged to (assistant message id for chats, run id for wake-ups). */
export type UsageScope = { userId: string; agentId: string | null; source: "chat" | "background"; ref: string | null };
/** What OpenRouter reported for one completion. `costUsd` is present when usage accounting is on. */
export type ModelUsage = { promptTokens: number; completionTokens: number; costUsd: number | null; requestId: string | null; model: string | null };
export type Charge = { costMicros: number; costSource: "openrouter" | "estimate" };

/**
 * Reserve-then-settle ledger. `reserve` atomically takes a hold or refuses; `settle` charges the real cost and
 * refunds the difference; `release` refunds a hold whose call never produced a response. Supabase in production,
 * in-memory in tests.
 */
export interface CreditLedger {
  /** Current balance in micros, or null when the user has no account yet. */
  balance(userId: string): Promise<number | null>;
  reserve(scope: UsageScope, holdMicros: number): Promise<string | null>;
  settle(entryId: string, usage: ModelUsage, charge: Charge): Promise<number | null>;
  release(entryId: string): Promise<number | null>;
}

/** Thrown before a model call when the balance cannot cover one hold. Routes translate it to 402. */
export class OutOfCredits extends Error {
  readonly code = "credits";
  constructor(message = "You’re out of credits. Your agent pauses until more are added.") { super(message); }
}

/** Fallback price when a provider omits cost, per million tokens in USD. Deliberately conservative. */
export const fallbackUsdPerMillionTokens = () => { const n = Number(process.env.SOCIALTRADING_FALLBACK_USD_PER_MTOKEN); return Number.isFinite(n) && n > 0 ? n : 1; };

export function usageToCharge(usage: ModelUsage, fallbackPerMillion = fallbackUsdPerMillionTokens()): Charge {
  if (usage.costUsd !== null && Number.isFinite(usage.costUsd) && usage.costUsd >= 0) return { costMicros: Math.ceil(usage.costUsd * MICROS_PER_USD), costSource: "openrouter" };
  const tokens = Math.max(0, usage.promptTokens) + Math.max(0, usage.completionTokens);
  return { costMicros: Math.ceil((tokens / 1_000_000) * fallbackPerMillion * MICROS_PER_USD), costSource: "estimate" };
}

/** Reads the `usage` block OpenRouter attaches to a completion (or to the final streamed chunk). */
export function parseOpenRouterUsage(body: { id?: unknown; model?: unknown; usage?: unknown } | null | undefined): ModelUsage | null {
  const u = body?.usage;
  if (!u || typeof u !== "object") return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cost = (u as { cost?: unknown }).cost;
  return {
    promptTokens: n((u as { prompt_tokens?: unknown }).prompt_tokens), completionTokens: n((u as { completion_tokens?: unknown }).completion_tokens),
    costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    requestId: typeof body?.id === "string" ? body.id : null, model: typeof body?.model === "string" ? body.model : null,
  };
}

/** Request body fields that make OpenRouter report cost, for both streaming and non-streaming calls. */
export const USAGE_ACCOUNTING = { usage: { include: true } } as const;

/** Wraps a model so every completion is reserved before and settled after. Refuses with `OutOfCredits` when the hold cannot be taken. */
export function meteredModel(inner: ModelClient, ledger: CreditLedger, scope: UsageScope, holdMicros: number, fallbackModel?: string): ModelClient {
  return {
    async complete(input) {
      const entry = await ledger.reserve(scope, holdMicros);
      if (!entry) throw new OutOfCredits();
      let reply: Awaited<ReturnType<ModelClient["complete"]>>;
      try { reply = await inner.complete(input); }
      catch (error) { await ledger.release(entry).catch(() => undefined); throw error; }
      const usage = reply.usage ?? { promptTokens: 0, completionTokens: 0, costUsd: null, requestId: null, model: fallbackModel ?? null };
      await ledger.settle(entry, { ...usage, model: usage.model ?? fallbackModel ?? null }, usageToCharge(usage)).catch(error => console.error("[credits] settle", error instanceof Error ? error.message : error));
      return reply;
    },
  };
}

/** In-memory ledger with the same invariants as the Postgres RPCs: atomic holds, idempotent settle and release. */
export class MemoryCreditLedger implements CreditLedger {
  balances = new Map<string, number>();
  entries: ({ id: string; status: "reserved" | "settled" | "released"; holdMicros: number; costMicros: number | null; usage: ModelUsage | null; charge: Charge | null } & UsageScope)[] = [];
  constructor(initial: Record<string, number> = {}) { for (const [user, micros] of Object.entries(initial)) this.balances.set(user, micros); }
  read(userId: string) { return this.balances.get(userId) ?? 0; }
  async balance(userId: string) { return this.balances.has(userId) ? this.read(userId) : null; }
  async reserve(scope: UsageScope, holdMicros: number) {
    const balance = this.read(scope.userId);
    if (balance < holdMicros) return null;
    this.balances.set(scope.userId, balance - holdMicros);
    const id = `u-${this.entries.length + 1}`;
    this.entries.push({ ...scope, id, status: "reserved", holdMicros, costMicros: null, usage: null, charge: null });
    return id;
  }
  async settle(entryId: string, usage: ModelUsage, charge: Charge) {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return null;
    if (entry.status === "reserved") { this.balances.set(entry.userId, this.read(entry.userId) + entry.holdMicros - charge.costMicros); Object.assign(entry, { status: "settled", costMicros: charge.costMicros, usage, charge }); }
    return this.read(entry.userId);
  }
  async release(entryId: string) {
    const entry = this.entries.find(e => e.id === entryId);
    if (!entry) return null;
    if (entry.status === "reserved") { this.balances.set(entry.userId, this.read(entry.userId) + entry.holdMicros); entry.status = "released"; }
    return this.read(entry.userId);
  }
}
