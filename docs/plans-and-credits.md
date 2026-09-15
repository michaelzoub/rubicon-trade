# Plans, limits, and credits

Design: `docs/superpowers/specs/2026-09-15-free-tier-limits-and-credits-design.md`.

## Where the truth lives

| Piece | Where | Notes |
|---|---|---|
| Plan catalogue | `lib/socialtrading/plans.ts` | Browser-safe. `PLANS.free` today. Adding a plan is one entry. |
| A user's plan and balance | `socialtrading_accounts` | `plan_id`, `limits` (snapshot, `null` = no cap), `credits_micros`. Created on first request with the default plan and its starting credits. |
| Usage ledger | `socialtrading_usage` | One row per model call: hold, settled cost, tokens, model, OpenRouter request id, `cost_source` (`openrouter` or `estimate`). |
| Enforcement | server (`limits.ts`, routes) **and** Postgres (`…0004_plans_credits.sql`) | Server answers in words; Postgres re-checks under per-user advisory locks. Same error shape either way. |

The server refreshes a stale `limits` snapshot when the catalogue changes (`loadAccount`), so Postgres always enforces what the code believes.

## Free plan

| Limit | Value | What it counts |
|---|---|---|
| `follows` | 5 | `profile.interests` with kind `stock` or `crypto`. Custom ideas do not count. |
| `preferenceItems` | 5 | Each of "Paying attention to" (all interests), "Things you care about", "Show me less". |
| `learnedAssets` | 25 | Non-theme entries in `state.inferred`. At the cap, `learn()` refuses new assets, keeps learning themes, and records one "memory is full" event per day. |
| `thesisChars` | 1,000 | `profile.thesis.length`. |
| `chats` | 20 | Chats across every agent. Deleting the last chat of an agent leaves an empty one. |
| `agents` | 3 | Rows in `socialtrading_agents`. |
| `enabledAgents` | 2 | Rows with `enabled = true`. |
| Credits | $5 | Granted once at account creation. |

**No new violations.** A change is refused only when it ends above the cap *and* above where it already was. Data saved before a limit existed stays editable as long as the offending part shrinks or holds.

## Errors

Limit: HTTP 422 with `{ error, code: "limit", limit, remedy }`. Credits: HTTP 402 with `{ error, code: "credits" }`. Postgres raises `LIMIT_<key>`, `AGENT_COUNT_LIMIT`, or `AGENT_LIMIT`; `translateDatabaseError` turns them into the same 422. The UI shows `error` (which already contains the remedy) and never retries.

## Credits

```
route → loadAccount → assertCredits (balance ≥ one hold, else 402)
  each model round: ledger.reserve(hold)  → atomic `update … where credits_micros >= hold`
                    OpenRouter call with usage: { include: true } (+ stream_options.include_usage for streams)
                    ledger.settle(cost)  → balance += hold − cost; ledger row settled
                    on transport failure: ledger.release(hold)
```

`hold` is `plan.credits.holdMicros` ($0.02 on free). A turn that runs out mid-way ends with a plain notice and everything so far is saved. Background runs check the balance before claiming a run (so an empty account produces no run rows), and are metered the same way with `ref = run id`. If OpenRouter omits `usage.cost`, the call is charged at `SOCIALTRADING_FALLBACK_USD_PER_MTOKEN` (default $1 per million tokens) and flagged `estimate`.

Balances are USD micros (1 USD = 1,000,000). The UI formats them with `formatCredits`.

## UI

`app/(hub)/_hub/limits-ui.tsx`: `UsagePill` (appears near or at a cap, muted when full), `LimitHint` (heads-up near the cap, explanation plus remedy at it), `CharCount` (past 80% of a text cap), `PlanNote` (dismissible, remembered per user in `localStorage`), `CreditsChip`. Rules: silence while there is room; count when close or interacting; explain and point at the remedy when full; never an error banner. Watch buttons at the follow cap surface the server's answer instead of failing silently.

## Adding a paid plan

1. Add `PLANS.pro` with its limits (`Infinity` for uncapped) and credits.
2. Set `plan_id = 'pro'` on the user's `socialtrading_accounts` row (and `credits_micros` as the plan grants). The next request snapshots the new limits.
3. Nothing else changes: routes, triggers, and the UI read the account.
