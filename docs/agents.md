# Agents and integrations

## Responsibilities

- `agents/config.ts`: browser-safe identity, behavior preferences, capability catalog, notification preferences (cadence, relevance threshold, daily cap), and validation. Agent IDs, creation timestamps, and `enabled` are server-owned; `enabled` mirrors the `socialtrading_agents.enabled` column and changes only through `PATCH /api/trade/agents`.
- `server.ts`: authenticated-user persistence. An agent owns one `HubState` (profile, interests, learning, messages, events, trades, and revision). Every read and write is scoped by **both user ID and agent ID**.
- `agents/registry.ts`: UI-independent `AgentCapability` / `AgentContext` contracts and `CapabilityRegistry`. It exposes only enabled tools and checks authorization again when executing them. Unknown tools fail closed; duplicate registrations fail at startup.
- `agents/builtins.ts`: composes the existing tools into profile, market, and trading capabilities. The original tool implementations remain grouped in `agent/tools.ts`; new capabilities can live in separate files.
- `agents/services.ts`: typed provider interfaces and the composition root for market services. Adapters own HTTP, credentials, provider normalization, and provider errors; capabilities own agent behavior.
- `agent/run.ts`: model conversation loop, independent of individual registered capabilities.
- `trades.ts` and `policy.ts`: deterministic trade permissions and limits, separate from behavior instructions and model output.
- `/api/trade/agents`: list, create (`POST`), enable or pause (`PATCH`, capped at two enabled agents per user in Postgres), and delete (`DELETE`, never the last agent). `/api/trade/agents/run` wakes an agent now; `/api/trade/agents/runs` lists recent wake-ups. The scheduled runtime is described in `docs/background-agents.md`. `/api/trade/state`, `/chat`, and `/market` accept `agentId`; omitted IDs select the migrated default for backward compatibility. A nonexistent agent never initializes implicitly.
- `plans.ts`, `limits.ts`, `credits.ts`, `account.ts`: the plan catalogue, the "no new violations" checks, the reserve-then-settle credit ledger, and the per-user account (plan, limits snapshot, balance, cross-agent usage). Every tool executor receives `context.limits`; `update_profile` adds what fits and reports what it skipped so the model can explain. Scheduled and manual runs are metered through `meteredModel`. See `docs/plans-and-credits.md`.
- `chats.ts`: chat threads. An agent owns `state.chats`; the client picks one, the chat route appends to it, and reach-outs land in the most recent one.
- `HubProvider`: active selection and request lifecycle. Selection persists per signed-in user in this browser; separate tabs may use different agents. Switching clears drafts and pending display state, remounts the current view, and ignores late learning responses from the previous agent. Saves and chats block switching until finished.

## Adding a capability or API

1. Implement a provider adapter behind an interface in `agents/services.ts` (or add a dedicated interface for a different service). Keep secrets server-side.
2. Implement an `AgentCapability<AgentServices>` with a stable ID and tools. Each tool supplies a JSON schema and an executor receiving the authenticated context and injected services. Validate tool arguments in the executor; model schemas alone do not validate runtime input.
3. Add its browser-safe label to `CAPABILITIES`, then register the capability in `agents/builtins.ts`. Existing agents do **not** automatically gain newly added capability IDs.
4. Return existing `MessagePart` types where possible. Only new presentation needs should require UI changes. Add tests covering disabled execution, argument validation, isolation, and provider failures.

A tool can use `context.userId`, `context.agentId`, and `context.signal` when calling a service. Do not accept ownership or credential identifiers from model arguments. A new provider for an existing capability can replace the adapter at the composition root without changing the runner or UI.

## Connections and trading

Market adapters currently use deployment-level credentials. The existing Robinhood connection remains available only to the migrated `default` agent; additional agents never inherit its access. New agents start with empty history and Notify me mode. Their behavior instructions cannot bypass the registry or deterministic trading policy.

Per-agent connection/OAuth UI is intentionally not implemented yet. When adding it, store encrypted connection records keyed by owner, agent, and service, resolve them server-side, and return only display-safe connection status. Extend the existing `Brokerage` interface or supply a service-specific capability rather than putting provider calls into React components.

### Onchain swaps (Uniswap through the user's Privy wallet)

`lib/crypto/*` is the crypto services layer: discovery (DexScreener), metadata (CoinGecko), valuation (DefiLlama), execution quotes and calldata (Uniswap Trading API), receipt verification (JSON-RPC), and Privy wallet ownership checks. Every `TradeIntent` records an `initiator`:

- `agent` (chat tools, background runs): `proposeSwap` runs `tradePolicy` with the agent's mode and limits. Notify me blocks; Ask before acting yields `approval_required`; Act within my limits yields `reserved`, which consumes the allowance at once. Invariant: value + committed agent spend in the window may never exceed the daily or weekly limit, and value may never exceed the per-trade limit.
- `user` (`POST /api/trade/crypto` with `action: propose`, from `/trade` or an asset page): the mode gate is skipped and the trade never counts against the agent's allowance. Decimals for unit conversion come from DefiLlama or CoinGecko, never from the client.

Both go through `prepareSwap`, which re-runs the policy with the trade's own initiator, refuses proposals older than a day, re-quotes, and hands out calldata exactly once. `confirmed` requires a verified receipt with two block confirmations. A background run may only reach `propose_crypto_swap` through the registry, so the same policy applies there.

Before enabling additional live execution services, implement durable pre-submission reservations and reconciliation/idempotency at the execution boundary. The existing trade flow sends before saving the enclosing turn; a state revision check after submission is not an execution lock. Keep account-wide limits distinct from agent-level limits if agents share a brokerage account.

## Scheduled runs

Enabled agents wake up through Vercel Cron every 30 minutes (`vercel.json` → `/api/cron/agents`, authenticated with `CRON_SECRET`). The runtime in `lib/socialtrading/runtime/` reuses the capability registry and services above, offers only read-only tools, applies the agent’s notification policy outside the model, and persists runs, notifications, and memory in Supabase. See `docs/background-agents.md`.

## Migration and verification

Apply `supabase/migrations/202609150002_agents.sql`, `202609150003_agent_runtime.sql`, and then `202609150004_plans_credits.sql` **before deploying this code**, after the original social-trading migration. The plans migration adds accounts and the usage ledger, moves each agent's conversation into `state.chats`, makes the enabled-agents trigger plan-aware, adds an agent-count trigger, and teaches the save RPC the profile and chat caps. The runtime migration adds `enabled`/`memory` columns, the two-agent trigger, run and notification tables, and cascading deletes; existing agents start disabled. It copies each workspace and its saved versions into the default agent, retains the original tables, enables RLS, restricts table/function access to the server role, and adds per-agent compare-and-swap saves. Deploy while old writers are stopped so no changes are lost after the copy. Do not roll back to old writers without reconciling newer agent data.

The migration is supplied in the repository; local unit tests do not apply it to a hosted database. Run `npm test`, `npm run typecheck`, and `npm run build`. `/preview?view=agents` offers an in-memory UI test surface for create, configure, and switch; reloading the preview resets its agents.
