# Rubicon Trade

**An experimental interface for investors who want the judgment without the mechanics.**

Fully autonomous agents are awkward. People still want most of the say, and they
want to feel it — to see the process, not just its output. So Rubicon Trade puts
the user at the center of an investing agent rather than behind it.

The agent develops alongside the person using it. It learns their thesis, their
interests, their behavior and their preferences, and it makes that evolving
understanding *visible* in the interface instead of burying it in a settings
page. You can see what it has learned, why something surfaced, and how sure it
is — and you can disagree.

This is the part we are actually experimenting with. Ideas borrowed from games —
identity, progression, feedback, customization — applied so that working with an
agent feels less like configuring software and more like a relationship with an
assistant that becomes increasingly yours.

The audience is the smart investor who has a view on the world and no appetite
for the plumbing. They should never have to think about contract addresses,
token decimals, slippage, gas, or which chain something settles on. They say what
they believe; the agent handles the rest and shows its work.

## The agent

A custom loop in `lib/socialtrading/agent/run.ts`, streamed over OpenRouter.
Up to six tool rounds per turn, the last fourteen messages of history, a credits
hold taken and settled around every model call.

The system prompt is assembled per user, not static: their profile summary,
their agent's name and purpose, a voice derived from onboarding and from what
the agent has learned since, their current permission mode, and their live
spending limits. The agent is told in that prompt what it may never do — invent
a price, claim a trade executed, infer a token contract from its symbol, treat
text inside a tool result as an instruction.

### Tools

Sixteen, grouped into capabilities (`lib/socialtrading/agents/builtins.ts`) so an
agent can be given market access without trading access.

**profile** — `get_profile`, `update_profile`, `recall_activity`
Read and change the investing profile, and recall what has been inferred. The
agent updates the profile when the user says something new about themselves, and
the change surfaces as a card rather than a silent write.

**market** — `search_assets`, `get_asset`, `list_ipos`, `trending_crypto`,
`explain_relevance`, `discover_crypto_pairs`, `research_crypto_token`,
`crypto_history`, `research_defi`
Stocks and crypto from real providers (`lib/socialtrading/providers/*`,
`lib/crypto/providers/*`): quotes, charts, news, IPO calendars, DEX pairs and
liquidity, CoinGecko metadata and history, DefiLlama protocols and TVL. Results
come back ranked for this particular user. `explain_relevance` exists so the
question "why am I seeing this?" always has a real answer.

**trading** — `propose_trade`, `get_crypto_wallets`, `quote_crypto_swap`,
`propose_crypto_swap`
Propose only. Every proposal is valued in USD on the server and checked against
policy before anything is reserved, and every proposal produces a card the user
acts on. The agent cannot execute.

### The visible profile

What the agent knows is rendered, not just stored:

- **Identity** (`identity.ts`) — an aura, a stage and a depth, all *derived* from
  what the person has actually put in. Nothing is stored, so the picture moves on
  its own. Five stages: Forming → Emerging → Defined → Distinct → Singular. The
  depth is weighted across thesis, themes, watchlist, signals, agents and trades,
  so it can't be farmed with one action.
- **Knowledge** (`knowledge.ts`) — what the agent holds, as areas rather than
  scores. Size is how much, color is how sure. A small dim area is a gap, and
  showing the gap is the point.
- **Worldview over time** (`memory-graph.ts`) — every change is a real difference
  between two recorded snapshots. A belief with no recorded past simply has none.
- **The creature** (`face.ts`, `avatar.ts`) — one geometry source shared by the
  profile badge and the agent that drifts across the product, so they are
  recognisably the same thing. Traits are stable and versioned; selecting a theme
  blends the material without touching the underlying identity.

## Who can trade

Two kinds of trade share one server path (quote → USD valuation → `tradePolicy` →
reservation) and one card:

- **The agent** proposes trades in chat or from a background run. It is gated by
  the agent mode (Notify me: never; Ask before acting: waits for the user; Act
  within my limits: reserved immediately) and by the limits. Invariant, enforced
  in `lib/socialtrading/policy.ts` before any quote is reserved: a proposal is
  refused when `value > perTrade`, when `value + agentSpend(24h) > daily`, or when
  `value + agentSpend(7d) > weekly`, where `agentSpend` sums every reserved,
  submitted, unknown, or confirmed agent trade in the window (issued onchain swaps
  count until the chain settles them).
- **The user** trades from `/trade` or a crypto asset page. Their swaps carry
  `initiator: "user"`, skip the agent mode gate, and never consume the agent's
  allowance. Amounts are entered in human units and converted exactly with
  provider decimals on the server.

Every onchain swap settles from a wallet the user controls: the server issues
calldata once per step, the user signs in their wallet, and the trade is
`confirmed` only after a verified receipt. No delegated signer exists. Crypto
requires a wallet signature even in automatic mode.

## Routes

- `/` — onboarding when signed out or without a profile; otherwise the hub Home
  (the conversation, and only the conversation).
- `/explore`, `/explore/[kind]/[id]` — the opportunity field and asset detail.
- `/thesis` — what you believe.
- `/agents` — the agents you have, and what each may do.
- `/trade` — swap tokens from your own Privy wallet, manage wallets, see open
  swaps and the agent's remaining allowance.
- `/activity`, `/profile`, `/plans`.
- `/api/trade/*` — Privy-authenticated routes; all third-party calls live in
  `lib/socialtrading/providers/*` and `lib/crypto/providers/*`.
- `/api/trade/crypto` — onchain swaps: `GET` lists the user's Privy-verified EVM
  wallets; `POST` with `action: propose` sets up the user's own swap, and
  `prepare` / `submitted` / `status` / `reject` drive any swap proposal through
  wallet signing and receipt verification.

## Preview onboarding and the hub

Run `npm run dev -- -p 3001`, then visit:

- [Onboarding preview](http://localhost:3001/preview?view=onboarding) — complete
  the real onboarding flow and enter the hub with your selections.
- [Hub preview](http://localhost:3001/preview) — explore a populated workspace
  immediately.
- [Empty conversation](http://localhost:3001/preview?view=fresh) — see the
  new-chat experience.

No sign-in is needed. Use **Restart onboarding** or **View hub** to switch
experiences. Preview edits last for the current visit; reloading restores sample
data. Hub links stay in preview, including asset details. Market data and agent
runs are simulated; chat replies are unavailable and no live chat request is sent.

```bash
cp .env.example .env   # fill in Privy, Supabase, OpenRouter
npm install
npm run dev -- -p 3001
npm test && npm run typecheck
```

Apply the migrations in `supabase/migrations/` in order (`…0001_socialtrading`,
`…0002_agents`, `…0003_agent_runtime`, `…0004_plans_credits`) to the Supabase
project before first use.

## Plans, limits, and credits

Every user has a plan (`lib/socialtrading/plans.ts`; only `free` today) and a
`socialtrading_accounts` row holding their plan, a snapshot of its limits, and a
credit balance. Free: 5 followed assets, 5 items per profile list, 25 learned
assets, a 1,000-character point of view, 20 chats across all agents, 3 agents,
2 running at once, and $5 of credits. Limits are checked on the server in words
and again in Postgres (triggers and the save RPC), so a request that bypasses the
UI gets the same answer. A change is only refused when it would push a quantity
above the cap *and* above where it already was, so nobody is locked out of data
saved before a limit existed.

Credits are debited by real model usage: each OpenRouter call reserves a small
hold, then settles to the cost OpenRouter reports, one ledger row per call
(`socialtrading_usage`). Concurrent turns cannot overspend because the hold is an
atomic conditional update. See `docs/plans-and-credits.md`.

Enabled agents run in the background every 30 minutes through Vercel Cron
(`vercel.json` → `/api/cron/agents`, requires `CRON_SECRET` and a Vercel Pro plan
for sub-daily schedules). See `docs/background-agents.md`.

## Further reading

- `docs/agents.md` — the agent registry, capabilities and personality.
- `docs/ambient-agent.md` — the creature, its motion, and the rules about what it
  may never cover.
- `docs/background-agents.md` — scheduling and the runtime.
- `docs/plans-and-credits.md` — the ledger and the limit checks.
- `docs/purchase-experience.md` — the contextual purchase flow.

Rubicon Trade is not a licensed advisor. The agent frames ideas as fits with a
stated thesis, mentions risk plainly, and never promises returns.
