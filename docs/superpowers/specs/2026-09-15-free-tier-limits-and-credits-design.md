# Free-tier limits and credits — design

Date: 2026-09-15. Scope: plan-based product limits enforced in Postgres and on the server, a credit balance debited by real OpenRouter usage, chat threads (so "chats" is a countable thing), and quiet usage indicators in the hub UI. Extends the existing per-agent `HubState`, `socialtrading_agents` compare-and-swap saves, the capability registry, and the background runtime rather than adding a parallel system.

## Assumptions (the session was non-interactive; these are the calls made)

1. **Chats are threads.** The product had one conversation per agent. "Maximum 20 chats" and "delete an old chat" only make sense with countable threads, so each agent now owns `chats: Chat[]`. The user can start, switch, and delete chats. The free cap of 20 counts chats across every agent the user owns. Existing conversations migrate into one chat per agent (id `default`).
2. **Followed assets** are `profile.interests` entries with `kind` `stock` or `crypto`. Custom "ideas" in the same list do not count as follows, but the whole "Paying attention to" list counts against the per-section cap.
3. **Per-section cap** (5 on free) applies to "Paying attention to" (all interests), "Things you care about" (`preferences`), and "Show me less" (`dislikes`). Themes are a fixed catalogue and are not capped.
4. **Learned assets** are `state.inferred` entries whose id is not a theme. At the cap, new assets are not learned (theme learning continues). One activity event per day explains that memory is full.
5. **Only increases are blocked.** A legacy profile over a cap can still be saved as long as the offending quantity shrinks or stays equal. Nobody gets locked out of their own data by a new limit.
6. **Plan catalogue lives in code**, plan assignment and balances live in Supabase. `socialtrading_accounts` stores `plan_id`, a `limits` snapshot, and `credits_micros`. Triggers and RPCs read the snapshot, so Postgres enforces exactly what the server believes. The server refreshes the snapshot when the catalogue changes.
7. **Credits are USD micros** (1 USD = 1,000,000). OpenRouter reports `usage.cost` in USD when `usage: { include: true }` is sent; that value is charged. If a provider omits cost, a token-based estimate is charged and flagged in the ledger.
8. **Concurrency** is handled by reserve-then-settle. Every model call first takes an atomic hold (`update ... where credits_micros >= hold`); the response settles the difference. Two requests can never both spend the last dollar.
9. **Unlimited** on a future paid plan is `Infinity` in code and `null` in the snapshot; SQL treats `null` as "no cap".

## Plan catalogue (`lib/socialtrading/plans.ts`, browser-safe)

```ts
type LimitKey = "follows" | "preferenceItems" | "learnedAssets" | "thesisChars" | "chats" | "agents" | "enabledAgents";
type Plan = { id: PlanId; name: string; limits: Record<LimitKey, number>; credits: { startingMicros: number; holdMicros: number } };
PLANS.free = { limits: { follows: 5, preferenceItems: 5, learnedAssets: 25, thesisChars: 1000, chats: 20, agents: 3, enabledAgents: 2 }, credits: { startingMicros: 5_000_000, holdMicros: 20_000 } };
```

Helpers: `limitStatus(limit, used)` → `{ used, limit, remaining, atLimit, nearLimit }` (near = within 20% or one slot), `formatCredits(micros)`, `followedAssets(interests)`, `learnedAssets(inferred)`, `LIMIT_COPY[key]` (label, remedy sentence).

## Data model

`HubState.messages` is replaced by `chats: Chat[]` where `Chat = { id, title, createdAt, updatedAt, messages: Message[] }`. `normalizeState` wraps legacy `messages` into a `default` chat and guarantees at least one chat. `MAX_MESSAGES` (200) applies per chat.

`Account` (returned beside state): `{ plan: Plan; limits: PlanLimits; credits: { balanceMicros, spentMicros, requests }; usage: { agents, enabledAgents, chats } }`.

## Migration `202609150004_plans_credits.sql`

- `socialtrading_accounts(user_id pk, plan_id, limits jsonb, credits_micros bigint, created_at, updated_at)`; `socialtrading_usage(id, user_id, agent_id, source chat|background, ref, status reserved|settled|released, hold_micros, cost_micros, prompt_tokens, completion_tokens, model, request_id, cost_source, created_at, settled_at)`. RLS on, service role only.
- Backfill: each `socialtrading_agents.state` gets `chats = [ { id: 'default', messages: state.messages } ]` and loses `messages`.
- RPC `socialtrading_account_get(p_user_id, p_plan_id, p_limits, p_credits)`: inserts the account if missing, returns the row with `agents`, `enabled_agents`, `chats`, `spent_micros`, `requests`.
- RPC `socialtrading_credits_reserve(user, agent, source, ref, hold) → uuid|null`, `socialtrading_credits_settle(entry, cost, prompt, completion, model, request_id, cost_source) → bigint`, `socialtrading_credits_release(entry) → bigint`. Settle and release are idempotent on `status`.
- Trigger `socialtrading_agents_count_limit` (insert): per-user advisory lock, `AGENT_COUNT_LIMIT` when rows ≥ `limits->>'agents'`.
- Trigger `socialtrading_agents_enabled_limit` now reads `limits->>'enabledAgents'` (default 2).
- `socialtrading_agent_save` enforces "no new violations" for thesis length, follows, section sizes, learned assets, and total chats (per-user advisory lock for chats), raising `LIMIT_<KEY>`. It reads the account snapshot, defaulting to free limits when no row exists.

## Server (`lib/socialtrading/`)

- `account.ts`: `loadAccount(userId)` (one RPC), `supabaseLedger: CreditLedger`, `translateLimitError(pgError)` → `LimitError`.
- `limits.ts` (browser-safe): `LimitError extends HubError` (status 422, `code: "limit"`, `limit`, `remedy`), `CreditsError` (402), `profileViolation(before, after, limits)` implementing the no-new-violations rule, `assertChatCapacity`.
- `credits.ts`: `CreditLedger` interface, `MemoryCreditLedger` for tests, `meteredModel(inner, ledger, scope)` wrapper, `usageToCharge(usage, model)`.
- `chats.ts` (browser-safe): `newChat`, `chatTitle`, `normalizeChats`, `latestChat`, `appendMessages`.
- `personalization.learn(state, action, target, themes, limits)`: skips new asset entries at the cap and records one "memory full" event per day.
- `agent/tools.ts`: `applyProfileUpdate(state, args, limits)` adds only what fits and reports what it skipped so the model can explain. Registry `AgentContext` carries `limits`.
- `agent/run.ts`: takes `chat`, `ledger`, `account`; sends `usage: { include: true }` and `stream_options: { include_usage: true }`; reserves before each round, settles after; stops the loop with a notice when out of credits.
- `runtime/model.ts` returns `usage`; `background-agent.ts` wraps the model with `meteredModel` and finishes the run as `skipped` with a clear summary when the balance is empty.

## Routes

- `GET/POST /api/trade/state` return `{ state, account }`. New action `chat` with `op: "create" | "delete"`. `profile`, `agent`, `signal watched`, `initialize` run `profileViolation`.
- `POST /api/trade/chat` takes `chatId`; refuses with 402 when the balance is below one hold; emits `{ type: "account" }` before `done`.
- `POST /api/trade/agents` pre-checks the agent cap and thesis, and maps the Postgres trigger to a 422. `PATCH` maps `enabledAgents`. All agent responses include `account`.
- `POST /api/trade/agents/run` refuses with 402 when the balance is empty.
- `failure()` serialises `{ error, code?, limit?, remedy? }`.

## UI

- `HubProvider` holds `account`, the active chat per agent (remembered in `localStorage`), `messages` (active chat plus in-flight), `newChat`, `deleteChat`, `selectChat`, `refreshAccount`. `signal("watched")` surfaces a limit error instead of swallowing it.
- `limits-ui.tsx`: `UsagePill` (light-blue pill, muted when full), `LimitHint` (one-line caption with remedy, appears near or at the limit, dismissible via `useDismissed(key)` stored per user), `CreditsChip`.
- Conversation: chat header with title, chat switcher, "New chat", delete; `n of 20 chats` pill only when ≥ 16 or at the cap; composer shows the credit balance quietly and disables with a plain explanation at $0.
- Profile: a dismissible one-line plan summary; counters on "Paying attention to", "Things you care about", "Show me less" when near or full; thesis character counter past 80%; "What I've learned" shows `n of 25 learned assets` with the pause notice when full; a compact "Plan & usage" block with credits spent.
- Agents: `n of 3 agents` pill beside "New agent", disabled with a hint at the cap; thesis counter in the form.
- Asset cards and asset detail: "Watch" at the cap sets the hub error with the remedy instead of failing silently.
- Onboarding uses the default plan's caps for thesis and interests.

## Error handling

Limit errors are 422 with `code: "limit"`; the provider shows `message` (which already contains the remedy). Credits errors are 402. Postgres exceptions `LIMIT_*`, `AGENT_COUNT_LIMIT`, `AGENT_LIMIT` are translated to the same shapes so a client bypassing the server checks gets the same answer. Model failures after a reservation release the hold.

## Testing

Unit: plan helpers, `profileViolation`, `learn` cap, chats normalisation, `MemoryCreditLedger` + `meteredModel` (reserve, settle, release, refusal), usage parsing. Route: state `chat create` at the cap, `signal watched` at the cap, agents `POST` at the cap, chat route 402. Runtime: background run refused without credits. UI: chat switcher and counters render from fixtures; existing hub tests updated for `chats`.
