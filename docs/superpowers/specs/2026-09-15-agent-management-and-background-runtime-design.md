# Agent management and background runtime — design

Date: 2026-09-15. Scope: the `/agents` page and a recurring, reusable agent runtime driven by Vercel Cron. Extends the existing agent abstractions (`agents/config.ts`, `agents/registry.ts`, `agents/builtins.ts`, `agents/services.ts`, `server.ts`) rather than adding a parallel system.

## Assumptions (the session was non-interactive; these are the calls made)

1. **Background runs are read-only toward money.** A scheduled run may research, learn, and reach out, but never calls `propose_trade`, `propose_crypto_swap`, `quote_crypto_swap`, or `get_crypto_wallets`, regardless of the agent mode. `docs/agents.md` already flags that live execution lacks durable reservations; the cron does not widen that exposure. Trades stay a conversation action.
2. **Notifications are in-app.** A finding becomes an assistant message in the agent’s conversation (so Home shows it), an activity event, and a row in `socialtrading_notifications`. Email/push are out of scope; the notification table is the hook for them.
3. **Existing agents start disabled.** Nothing runs until the user turns an agent on. Enabled state is a column, not part of the JSON blob, so the cron can query it and Postgres can enforce the limit.
4. **Every 30 minutes needs Vercel Pro.** Hobby crons run at most daily. `vercel.json` schedules `*/30 * * * *`; the route sets `maxDuration = 300`.
5. **Thesis, watchlist, mode, and limits are edited on the agents page too.** They live in `state.profile`; the `agent` state action accepts them alongside `config` so one Save writes everything. The Profile page remains for preferences, dislikes, and learned interests.

## Manage Agents UI

Layout: `hub-agents-layout` becomes a sticky left rail plus a scrolling form column.

- **Rail (sticky, `top` under the tab bar):** header “Your agents” with a `n of 2 running` counter; one row per agent with `ProfileAvatar`, name, one-line description, a status pill (Running / Paused), and a switch. Clicking the row selects; the switch enables/disables without selecting. The selected row uses the light-blue wash plus thin blue border (`--hub-blue-wash`, `--hub-blue-line`) and a 2px blue left mark; enabled rows carry a blue status pill; paused rows are muted. The switch is disabled with a tooltip when two agents are already running. “New agent” sits below the list. Under the rail, a section jump list (Identity · Behavior · Thesis & interests · Capabilities · Permissions · Notifications · Remove) highlights the section in view.
- **Form column:** header with the agent name, status, “Run now”, and the latest run summary (“Checked 12m ago · nothing worth surfacing”). Then sections as cards (`hub-agent-section`): Identity (name, description), Behavior (instructions), Thesis & interests (thesis textarea, watchlist chips), Capabilities (checkbox cards), Permissions (mode radios + limits when automatic), Notifications (cadence, relevance threshold, max per day), Remove (two-step delete; hidden for the only agent). Create mode reuses the form and hides Permissions and Remove.
- **Sticky action bar** at the bottom of the form column appears when dirty: “Unsaved changes · Discard · Save”. Saved state shows briefly.
- **Recent checks** list under the header shows the last runs (time, status, one-line decision) from the runs table so the user sees the agent living.

## Data model

`AgentConfig` gains `enabled: boolean` (server-owned, mirrored from the column) and `notifications: { cadenceMinutes: 30|60|180|360|1440; threshold: "low"|"medium"|"high"; maxPerDay: 1..12 }`. `agentConfig()` validates notifications and ignores `enabled`. `Message` gains `via?: "background"` so reach-outs can be labelled.

Migration `202609150003_agent_runtime.sql`:

- `socialtrading_agents.enabled boolean not null default false`, `memory jsonb not null default '{}'`.
- Trigger `socialtrading_agents_enabled_limit` on insert/update of `enabled`: takes `pg_advisory_xact_lock(hashtext(user_id))`, raises `P0001 'AGENT_LIMIT'` when more than two rows for the user are enabled.
- RPC `socialtrading_agent_set_enabled(p_user_id, p_agent_id, p_enabled) returns boolean` (false when the limit blocks it).
- `socialtrading_agent_save` also rewrites `state.agent.enabled` from the column so the JSON never contradicts it.
- Agent versions FK becomes `on delete cascade`.
- `socialtrading_agent_runs(id, user_id, agent_id, trigger, slot, status, started_at, finished_at, lease_until, summary, decision jsonb, error, notified)`; unique `(user_id, agent_id, slot) where slot is not null` (idempotent cron slots) and unique `(user_id, agent_id) where status = 'running'` (no overlap). RPC `socialtrading_agent_run_claim(...)` expires stale leases, inserts the running row, and returns its id or null.
- `socialtrading_notifications(id, user_id, agent_id, run_id, created_at, read_at, title, body, relevance, dedupe_key, parts jsonb)`; unique `(user_id, agent_id, dedupe_key) where dedupe_key is not null`.
- RPC `socialtrading_agents_due()` returns enabled agents with their latest `started_at`.
- All tables: RLS on, service role only.

## Runtime (`lib/socialtrading/runtime/`)

- `types.ts` — `RunTrigger`, `RunJob`, `RunOutcome`, `AgentMemory`, `RuntimeStore` interface, `ModelClient` interface.
- `store.ts` — Supabase implementation of `RuntimeStore`: `dueAgents`, `claimRun`, `finishRun`, `readMemory`, `writeMemory`, `notificationsToday`, `insertNotification`, `recentRuns`.
- `model.ts` — non-streaming OpenRouter chat completion with tool calls; same env as `agent/run.ts`.
- `background-agent.ts` — `runBackgroundAgent(job, deps)`: claim → load state + memory → build system prompt (identity, behavior, profile summary, memory notes, last run, notification budget, time since last run) → tool loop (≤5 rounds) over read-only tools from the enabled capabilities plus two runtime tools, `notify_user` and `remember` → enforce policy (threshold, daily cap, dedupe) → persist notification, memory, state (assistant message + event, CAS with one retry) → finish run. Errors finish the run as `failed` and never throw past the boundary.
- `dispatcher.ts` — `dispatchScheduledRuns({ store, execute, now, budgetMs, concurrency })`: computes the 30-minute slot, filters due agents by cadence, runs with bounded concurrency and a per-run timeout, isolates failures, stops launching when the budget is nearly spent and reports `deferred`. `execute` is the seam for a queue worker.

Entry points: `GET /api/cron/agents` (bearer `CRON_SECRET`, `maxDuration 300`), `POST /api/trade/agents/run` (authenticated manual trigger), `GET /api/trade/agents/runs` (recent runs for the UI). `vercel.json` declares the cron.

## Error handling

Model or provider failures fail that run only; the dispatcher continues. Save conflicts retry once with a reload and otherwise drop the conversation message (notification row still persists). A crashed run’s lease expires after 10 minutes so the next slot can claim.

## Testing

Unit tests with in-memory `RuntimeStore` and a scripted `ModelClient`: claim/overlap/idempotency, cadence filtering, capability gating of tools, threshold and daily cap, dedupe, failure isolation, memory persistence. Route tests for the enable limit, delete guard, cron auth. UI test for enable toggle limit and delete flow via `HubProvider` seam. `/preview?view=agents` fixtures updated.
