# Background agents

Agents that the user has turned on wake up on a schedule, look at the market through that user’s thesis, and reach out only when something clears the user’s notification bar. The design is in `docs/superpowers/specs/2026-09-15-agent-management-and-background-runtime-design.md`.

## Flow

```
Vercel Cron (*/30) → GET /api/cron/agents (CRON_SECRET)
  → dispatchScheduledRuns: socialtrading_agents_due() → cadence filter → bounded concurrency
    → runBackgroundAgent(job): claim run → load HubState + memory → system prompt
      → tool loop over read-only capability tools + notify_user / remember
      → policy: threshold, daily cap, dedupe → notification row + conversation message + activity event
      → memory (notes, last quotes, last summary) → finish run
```

Modules live in `lib/socialtrading/runtime/`:

| File | Role |
|---|---|
| `types.ts` | `RunJob`, `RunOutcome`, `AgentMemory`, the `RuntimeStore` and `ModelClient` interfaces. |
| `store.ts` | Supabase `RuntimeStore`. Reuses `loadState`/`saveState` so revisions stay consistent with the hub. |
| `memory-store.ts` | In-memory `RuntimeStore` with the same invariants; used by tests. |
| `model.ts` | Non-streaming OpenRouter completion (`OPENROUTER_API_KEY`, `SOCIALTRADING_MODEL`). |
| `background-agent.ts` | One wake-up. Never throws for agent, model, or provider failures. |
| `dispatcher.ts` | One cron tick. Slot key, cadence, concurrency, budget, isolation. |
| `production.ts` | Composition root: `executeRun` for cron and manual triggers. |

Entry points: `app/api/cron/agents` (cron), `app/api/trade/agents/run` (manual “Run now”), `app/api/trade/agents/runs` (recent checks for the UI). Trigger `chat` and `event` are reserved in the ledger for future callers of `runBackgroundAgent`.

## Guarantees

- **Two enabled agents per user.** `socialtrading_agents.enabled` is the truth. A trigger takes a per-user advisory lock and raises `AGENT_LIMIT`; `socialtrading_agent_set_enabled` translates that to `false`, which the API returns as 409. The UI mirrors the rule but never relies on it.
- **No overlapping runs.** A partial unique index on `(user_id, agent_id) where status = 'running'`, claimed through `socialtrading_agent_run_claim`. Leases expire after 10 minutes so a crashed run cannot block an agent forever.
- **Idempotent slots.** A cron run carries `slot = floor(now, 30 min)`; `(user_id, agent_id, slot)` is unique, so re-invoking the cron in the same slot skips instead of repeating.
- **Read-only toward money and profile.** `WRITE_TOOLS` (`update_profile`, `propose_trade`, `propose_crypto_swap`, `quote_crypto_swap`, `get_crypto_wallets`) are never offered and are refused if requested. Capabilities the agent has disabled are not offered either; `CapabilityRegistry.execute` checks again.
- **Policy outside the model.** Relevance threshold, per-day cap, and dedupe keys are enforced by the runtime from the agent’s `notifications` preferences. The model only proposes.
- **Fair dispatch.** Never-run agents go first, then the agents whose last scheduled check is oldest. Agents deferred by the time budget move ahead of recently checked agents on the next tick.
- **Timeouts.** Aborted runs stop before another tool call or notification delivery, including when a provider returns late.
- **Failure isolation.** Each run is wrapped; a model or provider error finishes that run as `failed` and the dispatcher continues. Save conflicts retry once after reloading; the notification row persists either way.
- **Vercel limits.** The cron route sets `maxDuration = 300` (Pro). The dispatcher runs three agents at a time with a 90-second per-run timeout and stops launching when fewer than 90 seconds remain, reporting the rest as `deferred`. To move work to a queue, replace `execute` in the route with an enqueue and run `runBackgroundAgent` in the worker; nothing else changes.

## Persistence

`supabase/migrations/202609150003_agent_runtime.sql` adds `enabled` and `memory` to `socialtrading_agents`, the enable trigger and RPC, `socialtrading_agent_runs`, `socialtrading_notifications`, `socialtrading_agents_due()`, `socialtrading_agent_run_claim()`, makes the versions FK cascade, and updates `socialtrading_agent_save` to keep `state.agent.enabled` equal to the column. Apply it after the two earlier migrations and before deploying this code. Existing agents start disabled.

## Configuration

- `vercel.json` schedules `/api/cron/agents` every 30 minutes. Hobby projects only allow daily crons; the schedule needs Pro.
- `CRON_SECRET` must be set in the Vercel project. Vercel sends it as `Authorization: Bearer <CRON_SECRET>`; the route fails closed (503) when unset and 401 otherwise.
- `OPENROUTER_API_KEY`, `SOCIALTRADING_MODEL`, and the market data keys are shared with the chat agent.

## Trying it locally

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3001/api/cron/agents
```

The response is the dispatch report. From the UI, “Run now” on the agents page triggers a `manual` run and shows the outcome; `/preview?view=agents` renders the page against fixtures without a database.

## Verifying scheduling

A successful cron response with `considered: 0` confirms that authorization and the database RPC work, but means there are no enabled agents. Turn on an agent in Manage agents before expecting scheduled checks. A real check should appear in its recent runs with trigger `cron`.

`npm run dev` serves the cron endpoint but does not schedule it. Automatic half-hourly invocation comes from the deployed Vercel project and `vercel.json`; configure `CRON_SECRET` in that project's environment as well as locally. A local secret is not synchronized to Vercel. Verify the deployed cron invocation logs and a recorded scheduled run before treating production scheduling as operational.
