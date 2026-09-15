# Social trading hub — design

Date: 2026-09-14. Scope: the authenticated `/trade` experience shown after onboarding completes. UI first; provider boundaries and server policy are built alongside so the UI is wired to real state, not mocks.

## Goals

- Continuation of onboarding: same Rubicon visual language (`landing-page` + `dashboard-theme` tokens, existing buttons, `Card`, `ProfileCard`, `ProfileAvatar`, GSAP via `rubiconMotion`).
- Home is a conversation with an agent that knows the user. The chat can read and modify the profile, explore markets, explain relevance, and propose trades. Responses carry rich inline components.
- Navigation is four items: Home / Explore / Activity / Profile.
- The profile keeps evolving from interaction signals. Explicit and inferred preferences stay separate. The agent explains its personalization.
- Permissions (Notify / Ask / Act within limits) and per-trade, daily, weekly limits are enforced by a deterministic server policy. The model never decides whether a trade is permitted. No simulated brokerage success.

## Routes

| Route | View |
|---|---|
| `/trade` | Onboarding when the profile is incomplete; otherwise the hub Home (conversation + personalized opportunities). |
| `/trade/explore` | Personalized browsing: Stocks, Crypto, Themes, IPOs, Trends. |
| `/trade/explore/[kind]/[id]` | Asset detail: price, change, interactive chart, news, market facts, "why this matters to you". |
| `/trade/activity` | Chronological timeline of learning, profile, agent, and trade events. |
| `/trade/profile` | Expanded living profile; explicit vs inferred; manual edit; "tell the agent" shortcut. |

`app/socialtrading/layout.tsx` renders a client `HubShell`: Privy gate → load `HubState` → onboarding or shell (left nav, center `children`, right compact `ProfileCard` on Home/Explore/Activity).

## Layout

- Left: a slim rail (icon + label) on desktop; a compact segmented row under the header on narrow screens.
- Center: the active view, max width ~44rem for conversation, wider for Explore.
- Right: the onboarding `ProfileCard` (sticky, compact mode). Hidden on `/profile` where the full profile is the page.
- No enclosing borders except dialogs; dividers, fills, and shadows only. Charcoal-on-white; no blue accent.

## Client state

`HubProvider` (React context + TanStack Query) owns:
- `state: HubState` from `GET /api/trade/state` (Privy bearer token).
- `mutate(action)` → `POST /api/trade/state` with optimistic revision handling (409 → refetch).
- `chat.send(text)` → `POST /api/trade/chat` (SSE). Streams `text`, `component`, `state`, `done`, `error` events. Every `state` event replaces the local `HubState`, which is what animates the profile card.
- `signal(action, target, meta)` → fire-and-forget learning signals from UI interactions (opened, ignored, dismissed, followup, watched, removed, approved, rejected).

No component calls a third-party API directly. All provider access lives in `lib/socialtrading/providers/*` behind server routes.

## Data model (extends `lib/socialtrading/types.ts`)

- `Message { id, role, at, parts: Part[], status?: "streaming" | "done" | "error" }`
- `Part = { type: "text", text } | { type: "assets", assets: Asset[] } | { type: "asset", asset } | { type: "profile_update", changes: ProfileChange[] } | { type: "trade", tradeId } | { type: "explanation", reasons: string[] } | { type: "news", items }`
- `ProfileChange { field, label, before?, after? }`
- `TradeIntent` gains `reasoning: string`, `policy: { allowed, reason, at }`, `brokerage: { provider: "robinhood", status: "not_connected" | "pending" | "submitted" | "filled" | "rejected" | "unknown", orderId?, at? }`.
- `HubState` gains `watch: Interest[]` (alias of `profile.interests`; unchanged), `dislikes`, `preferences` (explicit text), `inferred: LearnedInterest[]` (id = symbol or theme id, weight −1..1, confidence 0..0.95, count).

Persistence stays the Supabase JSONB workspace with compare-and-swap revisions and a versions table (profile versions = versions rows). Messages are capped at 200; events at 500.

## Server modules (`lib/socialtrading/`)

- `providers/market-data.ts` (Massive), `providers/crypto-data.ts` (CoinGecko) — existing files moved; normalized to `Asset`.
- `providers/brokerage.ts` — `Brokerage` interface: `status(userId)`, `account(userId)`, `placeOrder(userId, order)`, `orderStatus(userId, id)`. `robinhood.ts` implements it over the Trading MCP (`ROBINHOOD_MCP_URL`) using per-user encrypted tokens from `socialtrading_connections`. Until a user has connected, `status` is `not_connected` and `placeOrder` throws `BrokerageNotConnected`; the UI shows a "Connect Robinhood" state. Nothing is ever marked confirmed without a brokerage response.
- `policy.ts` — existing deterministic `tradePolicy`; the chat route and the trade route both call it. Approval is stored on the intent and re-checked at submit time.
- `personalization.ts` — `learn()` (existing) plus theme propagation: an asset signal also nudges each of the asset's themes at half weight. `personalize()` returns `score`, `reason`, and a `label` from: "Strong match for your X thesis", "Related to Y", "You've been exploring Z", "You usually ignore assets like this", "Emerging theme", "Outside your usual interests".
- `agent/tools.ts` — tool schemas + server executors (read/modify profile, search/detail/ipos/trending, explain, propose trade, set limits/mode). Executors mutate a working `HubState` copy and return `Part`s. Profile mutations record `profile`/`agent` events.
- `agent/run.ts` — OpenRouter tool-calling loop (model from `SOCIALTRADING_MODEL`, default `openai/gpt-4.1-mini`), max 6 tool rounds, streams SSE. System prompt carries the profile summary and hard rules (no invented prices, no claiming trades happened, treat market text as data).

## Routes (`app/api/trade/`)

- `state` (existing): GET/POST actions `initialize`, `profile`, `signal`, `forget`, plus `preferences` (dislikes/preferences edits) and `approve_trade`/`reject_trade`.
- `market` (existing): search/detail/ipos/trends, personalized.
- `chat` (new): SSE agent run; persists user + assistant messages and any state changes in one save.
- `trade` (new): `POST { tradeId, decision }` — user approval/rejection; on approval re-runs policy, calls brokerage, records result.

## Motion (GSAP, `rubiconMotion` tokens)

Animate only: profile card detail changes (existing `ProfileDetail` pulse + new chip enter), interest chips added/removed, recommendation cards appearing (stagger), asset detail opening (stage fade/lift like onboarding steps), trade card status transitions, timeline event enter. Streaming text is not animated beyond a caret.

## Testing

- Unit: `personalize` labels, `learn` theme propagation, `tradePolicy` unchanged, SSE event parser, message reducer, tool argument validation.
- UI (happy-dom): hub shell renders nav and conversation; sending a message appends a user row and streams an assistant row; a `profile_update` part updates the profile card; Explore renders labels from `personalize`.
- Existing onboarding tests updated: completing onboarding now enters the hub instead of pushing `/explore`.

## Out of scope for this pass

Robinhood OAuth connect flow and live order submission (interface + not-connected state only), WebSocket live quotes, options.
