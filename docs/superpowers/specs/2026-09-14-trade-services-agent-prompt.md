# Prompt: wire live services into the /trade hub

You are working in the Rubicon marketing repo (Next.js 15 app router, TypeScript, Vitest, Privy auth, Supabase with service-role server client, OpenRouter as the only LLM provider). The `/trade` hub UI is built and fixture-tested; the service layer is partially stubbed. Your job is to make every provider real without changing the UI contract.

Read first: `docs/superpowers/specs/2026-09-14-socialtrading-hub-design.md`, `lib/socialtrading/types.ts`, `lib/socialtrading/providers/*`, `lib/socialtrading/trades.ts`, `lib/socialtrading/policy.ts`, `lib/socialtrading/agent/*`, `app/api/trade/*`, `app/trade/_hub/client.ts`. Run `npx vitest run` and `npx tsc --noEmit -p .` before and after; both are green today (145 tests, one known-flaky `trades.test.ts` case that you should fix rather than skip).

## Non-negotiable rules

- Secrets only on the server. No `NEXT_PUBLIC_*` for Massive, CoinGecko, Uniswap, Robinhood, Privy authorization keys, or OpenRouter. All third-party calls go through `lib/socialtrading/providers/*` and are reached from React only via `/api/trade/*`.
- `Asset` (in `lib/socialtrading/types.ts`) is the only shape the UI sees. Normalize every provider into it.
- The model never decides whether a trade is allowed. `tradePolicy` in `lib/socialtrading/policy.ts` runs on the server before any order; keep its tests passing and add tests for anything you change.
- Never mark a `TradeIntent` `confirmed` without an explicit fill from the brokerage or an onchain receipt. `submitted`, `unknown`, `failed`, `not_connected` are the honest states.
- Persist everything in the existing JSONB workspace (`socialtrading_workspaces` + `socialtrading_versions`, compare-and-swap via `socialtrading_save`). Add tables only for credentials/OAuth state (already scaffolded: `socialtrading_connections`, `socialtrading_oauth`).
- Do not commit `.env`. Add new variable names to `.env.example` with empty values.

## 1. Stock and market data: Massive (formerly Polygon.io)

Client: `lib/socialtrading/providers/market-data.ts` already targets `https://api.massive.com` with `Authorization: Bearer $MASSIVE_API_KEY`. Polygon endpoints are unchanged under the new domain.

- Verify and keep: `/v3/reference/tickers` (search), `/v3/reference/tickers/{ticker}` (profile, market cap), `/v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` (last trade, day change), `/v2/aggs/ticker/{ticker}/range/1/day/{from}/{to}` (daily bars), `/v2/reference/news?ticker=` (news), `/vX/reference/ipos` (IPOs).
- Add intraday bars for the 7D chart range (`range/1/hour`), and 1Y with `sort=asc&limit=400`.
- Add a `quote(symbols[])` batch method using the snapshot "all tickers" endpoint filtered by `tickers=` so Explore and asset cards do one call, not N.
- Free tier is delayed and rate-limited (5 req/min). Cache with `next: { revalidate }` (already used) and add an in-process LRU keyed by URL with a 60s TTL for snapshots and 15 min for reference data. Surface `asOf` so the UI can say "as of 15 min ago".
- Optional later: WebSocket `wss://socket.massive.com/stocks` behind a server route that fans out via SSE; do not open sockets from the browser with a key.
- Docs: https://massive.com/docs (REST quickstart under `/docs/rest/quickstart`, stocks under `/docs/rest/stocks`).

## 2. Crypto discovery: CoinGecko

Client: `lib/socialtrading/providers/crypto-data.ts` uses the Demo base `https://api.coingecko.com/api/v3` with header `x-cg-demo-api-key`. Pro uses `https://pro-api.coingecko.com/api/v3` and `x-cg-pro-api-key`; make the base URL and header switch on `COINGECKO_PLAN=demo|pro`.

- Keep: `/coins/markets` (price, cap, volume, `sparkline=true` for the card sparkline), `/search`, `/search/trending`, `/coins/{id}/market_chart?days=`, `/coins/{id}` (categories, description).
- Add: `/coins/categories` for the Explore "Themes" tab mapping (e.g. AI, Layer 1, Meme) and to power dislikes such as "memecoins" (filter by category, not just name regex; `relevance()` in `lib/socialtrading/personalization.ts` should receive `asset.themes` from categories).
- Add emerging-asset discovery via the onchain (GeckoTerminal) endpoints: `/onchain/networks/{network}/trending_pools` and `/onchain/networks/{network}/new_pools`, normalized into `Asset` with `kind: "crypto"`, `labelTone: "emerging"`, and `source: "CoinGecko"`.
- Demo plan is roughly 30 calls/min with a monthly credit cap; add the same LRU cache and exponential backoff on 429.
- Docs: https://docs.coingecko.com/reference/introduction (full index at https://docs.coingecko.com/llms.txt).

## 3. Brokerage: Robinhood Agentic Trading (equities and crypto via a dedicated Agentic account)

Facts to design around (from Robinhood's public materials): the MCP endpoint is `https://agent.robinhood.com/mcp/trading`; connection is OAuth through Robinhood's own login so the app never sees credentials; read access spans the user's accounts but trades only execute in a separate, user-funded Agentic account; agents can trade without per-trade confirmation if configured that way, which is why our server-side policy is mandatory; onboarding is desktop-only. Robinhood does not publish tool names or parameter schemas, so discover them at runtime.

Implement in `lib/socialtrading/providers/brokerage.ts` (interface already defined: `status`, `placeOrder`; extend with `account`, `positions`, `orderStatus`).

- OAuth per MCP spec (OAuth 2.1 + PKCE). Discovery: call the MCP URL unauthenticated, read `WWW-Authenticate` → `/.well-known/oauth-protected-resource` → `/.well-known/oauth-authorization-server`. If the server supports Dynamic Client Registration (RFC 7591), register once and cache the client id in a server-only table; otherwise read `ROBINHOOD_CLIENT_ID`/`ROBINHOOD_CLIENT_SECRET` from env. Redirect URI is `${SOCIALTRADING_APP_URL}/api/trade/robinhood/callback` (never derive from request headers).
- Routes: `GET /api/trade/robinhood/connect` (authenticated via Privy bearer; stores PKCE verifier + state hash in `socialtrading_oauth` encrypted with `SOCIALTRADING_ENCRYPTION_KEY`, redirects), `GET /api/trade/robinhood/callback` (validates state, exchanges code, encrypts tokens AES-256-GCM as `iv.tag.body` base64 into `socialtrading_connections`, records an `agent` event "Connected Robinhood"), `POST /api/trade/robinhood/disconnect`. Refresh tokens transparently in `userToken()`.
- Tool discovery: on first use per user, `tools/list`; pick tools by inspecting names/descriptions for account/buying power, positions, order placement, and order status; persist the chosen names in `state.brokerage.tools` so behaviour is stable and visible. If no order tool is found, `placeOrder` must throw and the UI shows "Robinhood didn't expose an order tool".
- `placeOrder` uses notional (USD) market orders for equities and crypto pairs (e.g. `BTC-USD`) in the Agentic account only; pass `client_order_id = trade.id` for idempotency. Parse results conservatively (see `parseOrder`): fill → `confirmed`; explicit reject → `failed`; order id without fill → `submitted`; anything else → `unknown`.
- Add `POST /api/trade/robinhood/sync` and call it from the chat route lazily (every 5 min) to update `state.brokerage` (connected, buying power) and to poll `submitted`/`unknown` intents via `orderStatus`, appending trade events. Activity and the trade card must show the resulting brokerage status.
- UI: a "Connect Robinhood" button on the Profile page and inside `TradeCard` when `state.brokerage.connected` is false; show buying power on the compact profile card once connected.
- Only Robinhood's confirmation changes a trade to `confirmed`. Never simulate.

## 4. Onchain crypto execution: Uniswap Trading API (optional second brokerage)

Use this to let "buy $50 of ETH" settle onchain from the user's Privy embedded wallet when Robinhood crypto is unavailable (e.g. New York) or the user prefers self-custody. Implement as a second `Brokerage` (`provider: "uniswap"`) selected per intent by `state.profile` preference or asset availability; the policy layer is shared.

- Trading API: base `https://trade-api.gateway.uniswap.org/v1`, headers `x-api-key: $UNISWAP_API_KEY`, `x-universal-router-version: 2.0`, `Content-Type: application/json`. Flow: `POST /check_approval` (Permit2 approval tx if needed) → `POST /quote` (routing `CLASSIC` or UniswapX `DUTCH_V2`; the response includes the quote and, for classic, a fully formed transaction) → `POST /swap` (classic, gasful: we broadcast) or `POST /order` (UniswapX, gasless: market maker fills). Get keys at https://developers.uniswap.org/dashboard; docs at https://developers.uniswap.org/docs/trading/swapping-api/getting-started and supported chains at https://developers.uniswap.org/docs/trading/swapping-api/supported-chains.
- Chain: Rubicon settles on Arc Testnet (`lib/chain.ts`), which Uniswap does not route. Execute swaps on a supported chain (start with Base; USDC in, target token out) and record the chain id on the intent. Document this clearly in the UI ("settles on Base").
- Signing: use Privy server signers, not raw keys. The user consents once by adding the app's authorization key as a signer on their embedded wallet (`addSigners` on the client), and the server signs via the Privy Node SDK with `privy-authorization-signature`. Attach a Privy policy that mirrors the user's limits (max notional per tx, allowed contracts = Universal Router + Permit2 + USDC). Docs: https://docs.privy.io/recipes/wallets/user-and-server-signers.
- Status: `submitted` when the tx hash is known; `confirmed` only after a receipt with `status === "success"` (viem `waitForTransactionReceipt` in the sync route, or poll UniswapX order status for `filled`). Record hash, chain, amounts, and gas in `trade.brokerage.detail`.
- Env: `UNISWAP_API_KEY`, `UNISWAP_CHAIN_ID=8453`, `PRIVY_AUTHORIZATION_PRIVATE_KEY`, `PRIVY_KEY_QUORUM_ID`.

## 5. Agent and persistence follow-ups

- `lib/socialtrading/agent/run.ts` uses `SOCIALTRADING_MODEL` (default `openai/gpt-4.1-mini`) via OpenRouter with tool calling. Add a `get_portfolio` tool (brokerage positions and buying power when connected) and a `compare_venues` tool that returns Robinhood vs Uniswap availability and estimated cost for a crypto buy.
- Add `POST /api/trade/watch` to record `watched`/`removed` outside chat (already handled through the `signal` action; keep one path).
- Write Supabase migration `2026xxxxx_socialtrading_connections.sql` if you change the connections/oauth tables (add `provider text` so Uniswap consent and Robinhood tokens can coexist).
- Tests: OAuth state/PKCE round trip with mocked fetch; `parseOrder` on fill/reject/unknown payloads; Uniswap quote→swap→receipt state machine with mocked Privy signer; CoinGecko category-based dislike filtering; Massive batch quote normalization.

## Definition of done

- `/trade` Explore shows live Massive and CoinGecko data with personalization labels; asset detail charts load for 7D/30D/90D/1Y.
- A user can connect Robinhood from Profile, see buying power on the card, approve a proposed trade, and watch its status move to submitted/confirmed from Robinhood's own responses.
- A user can opt into onchain execution, consent once in Privy, and complete a USDC→token swap on Base with the tx hash shown in Activity.
- Every trade path passes `tradePolicy` on the server; tests cover Notify/Ask/Act modes and rolling limits.
- No secrets in the client bundle (`grep -r NEXT_PUBLIC_ .env.example` shows only Privy/Supabase/PostHog).
