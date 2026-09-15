# Rubicon Trade

The social trading hub: an investing-profile onboarding flow and an agent that explores markets, explains relevance, and proposes trades within deterministic server-side limits.

- `/` — onboarding when signed out or without a profile; otherwise the hub Home (conversation).
- `/explore`, `/explore/[kind]/[id]`, `/trade`, `/activity`, `/profile` — hub views. `/trade` is where the user swaps tokens from their own Privy wallet, manages wallets, and sees open swaps and the agent's remaining allowance.
- `/api/trade/*` — Privy-authenticated routes; all third-party calls live in `lib/socialtrading/providers/*` and `lib/crypto/providers/*`.
- `/api/trade/crypto` — onchain swaps: `GET` lists the user's Privy-verified EVM wallets; `POST` with `action: propose` sets up the user's own swap, and `prepare` / `submitted` / `status` / `reject` drive any swap proposal through wallet signing and receipt verification.

## Who can trade

Two kinds of trade share one server path (quote → USD valuation → `tradePolicy` → reservation) and one card:

- **The agent** proposes trades in chat or from a background run. It is gated by the agent mode (Notify me: never; Ask before acting: waits for the user; Act within my limits: reserved immediately) and by the limits. Invariant, enforced in `lib/socialtrading/policy.ts` before any quote is reserved: a proposal is refused when `value > perTrade`, when `value + agentSpend(24h) > daily`, or when `value + agentSpend(7d) > weekly`, where `agentSpend` sums every reserved, submitted, unknown, or confirmed agent trade in the window (issued onchain swaps count until the chain settles them).
- **The user** trades from `/trade` or a crypto asset page. Their swaps carry `initiator: "user"`, skip the agent mode gate, and never consume the agent's allowance. Amounts are entered in human units and converted exactly with provider decimals on the server.

Every onchain swap settles from a wallet the user controls: the server issues calldata once per step, the user signs in their wallet, and the trade is `confirmed` only after a verified receipt. No delegated signer exists.
- `/preview` — fixture-driven hub for design review, no sign-in.

```bash
cp .env.example .env   # fill in Privy, Supabase, OpenRouter
npm install
npm run dev -- -p 3001
npm test && npm run typecheck
```

Apply the migrations in `supabase/migrations/` in order (`…0001_socialtrading`, `…0002_agents`, `…0003_agent_runtime`, `…0004_plans_credits`) to the Supabase project before first use.

## Plans, limits, and credits

Every user has a plan (`lib/socialtrading/plans.ts`; only `free` today) and a `socialtrading_accounts` row holding their plan, a snapshot of its limits, and a credit balance. Free: 5 followed assets, 5 items per profile list, 25 learned assets, a 1,000-character point of view, 20 chats across all agents, 3 agents, 2 running at once, and $5 of credits. Limits are checked on the server in words and again in Postgres (triggers and the save RPC), so a request that bypasses the UI gets the same answer. A change is only refused when it would push a quantity above the cap *and* above where it already was, so nobody is locked out of data saved before a limit existed.

Credits are debited by real model usage: each OpenRouter call reserves a small hold, then settles to the cost OpenRouter reports, one ledger row per call (`socialtrading_usage`). Concurrent turns cannot overspend because the hold is an atomic conditional update. See `docs/plans-and-credits.md`.

Enabled agents run in the background every 30 minutes through Vercel Cron (`vercel.json` → `/api/cron/agents`, requires `CRON_SECRET` and a Vercel Pro plan for sub-daily schedules). See `docs/background-agents.md`.
