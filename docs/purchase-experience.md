# Purchase correctness and deployment

## Audit and architecture

The previous purchase path discarded Uniswap's `permitData`, built `/swap` without a required Permit2 signature, disabled simulation, and tried to compensate with ERC20/Permit2 approvals inside an EIP-7702 batch. The signing action silently called `switchChain`. Every purchase depended on a public bundler and Circle paymaster even though neither compatibility nor available sponsorship was established. Server balance checks covered USDC only, and execution decimals came from market metadata. Existing receipt verification and optimistic state persistence were worth keeping.

The production path now uses **Privy authentication and the selected Privy wallet provider for signing/submission**, and **Uniswap CLASSIC V2/V3 exact-input execution**. Dynamic is not installed: there is no second delegated wallet, duplicated auth flow, or claimed autonomous execution. Agent proposals still require the user's signature, with deterministic server policy checks outside the LLM.

Source of truth: Privy user → verified linked wallet → explicit chain/token contracts → onchain decimals and balances → stored fresh quote → bounded authorization → nonce-bound transaction → verified receipt.

## Lifecycle

1. **Proposal:** exact decimal input conversion using `decimals()` on the selected chain. A read-only Uniswap estimate captures the reviewed minimum output. Symbols and market metadata are display information, not execution identifiers.
2. **Preflight:** verify Privy wallet ownership, configured RPC chain ID, exact input/output decimals, input balance, that chain's native USDC balance, native gas, current policy, and proposal age. Ethereum USDC never contributes to a Base balance. Client checks the selected account and network before and after reads. When the user clicks Review & sign, the client requests the purchase network through the selected Privy wallet if needed, then reacquires its provider and verifies the account and network. Read-only checks and signing helpers never switch accounts or networks.
3. **Approval:** read the input token's allowance to canonical Permit2. Skip sufficient allowance; otherwise issue an exact-amount ERC20 approval (zero-reset first when necessary). Simulate and check native gas before issuance. Each approval is signed through Privy's EIP-1193 provider, broadcast, journaled with its real hash, and independently confirmed. An approval receipt returns the purchase to **Continue**; it never marks the purchase successful.
4. **Fresh quote:** after confirmed approvals, request a new Uniswap quote with `permitAmount: EXACT`. Check chain, swapper, recipient, token addresses, exact input, slippage, and minimum output. Refuse a quote below the user's reviewed minimum. Store an expiring quote and unique quote ID. A refresh invalidates earlier authorizations.
5. **Permit2:** if required, validate the signing schema, chain/domain, canonical Permit2 address, pinned Uniswap UniversalRouterV2 spender, exact amount/token, and expiry. Sign the API's values through the selected Privy provider. The server verifies the signature against that wallet and the stored quote. It passes both `permitData` and `signature` to `/swap`. Missing, changed, expired, or mismatched signatures cannot create a swap.
6. **Swap creation:** For a USDC-fee batch, request router calldata without a separate Permit2 signature and without standalone gateway simulation: the batch grants both exact approval layers before swapping. Simulate the full batch through a read-only RPC call with a temporary EIP-7702 implementation code override before issuing it. The bundler then validates authorization, paymaster and operation gas. For a standalone transaction, Uniswap simulation remains enabled. Verify the returned chain/from/router/value/calldata. Independently estimate gas against the configured RPC. Base and Optimism additionally read L1 data and operator fees. Use a conservative 2× fee estimate buffer; estimates are not guaranteed future network prices. Native-input swaps must retain gas after their input amount.
7. **Wallet signature and broadcast:** persist the issued transaction and its pending account nonce before handing calldata to the client. Recheck account/network/expiry/gas and nonce before `eth_sendTransaction`, passing explicit from, chain ID and nonce. Never infer broadcast success from a wallet prompt. Keep the actual returned hash locally immediately and persist it server-side. No automatic resubmission.
8. **Confirmation:** server RPC verifies transaction sender, recipient, calldata, native value, and nonce, then checks a successful receipt, canonical block hash, and two subsequent blocks. Only then set `confirmed`. Pending receipts remain pending; RPC errors preserve uncertainty; reverts become failed. Approval and swap hashes remain in the history. The UI polls every eight seconds while mounted and provides manual status/hash recovery.

Required approvals are separate wallet transactions. After an approval confirms, the user continues the purchase; another approval may be needed after a zero-reset. This is intentional: quoting before approvals settle can produce stale or unexecutable authorization.

## Recovery and limits

A rejected Permit2 request can be retried with a fresh quote. For an issued wallet transaction with no recorded hash, **Retry same wallet request** returns only its original calldata and nonce, while still valid, and only if the RPC reports that nonce unused. The chain can execute that nonce at most once. If a transaction is pending, its nonce changed, or the quote expired, recover its hash from the wallet and use **Verify**. The server will not issue a new transaction for an uncertain attempt. An expired swap must not be resubmitted; create a fresh purchase only after checking the old attempt. Unknown agent reservations remain held rather than incorrectly freeing possibly spent funds.

A hash lost between wallet broadcast and server persistence can be recovered from local storage or the wallet. Cross-device recovery requires the wallet hash. A replacement/cancellation with different calldata is not a successful purchase and is not automatically reconciled. No transaction is sent in the background merely because a user returns to the app.

New purchases do not upgrade wallets or use the old Circle paymaster/bundler path. Legacy batch verification and user-operation receipt recovery remain available for previously issued purchases. Contract-wallet-specific ERC-1271 signatures and sponsored-operation receipts need a separately tested adapter; the new path supports standard EVM wallet transaction signatures and 65-byte EOA Permit2 signatures.

## Environment and dashboard setup

Copy `.env.example` and configure:

- `NEXT_PUBLIC_PRIVY_APP_ID`, optional `NEXT_PUBLIC_PRIVY_CLIENT_ID`, and server-only `PRIVY_APP_SECRET`. In the Privy dashboard, register the deployed/local origins and desired login methods, enable Ethereum embedded wallets if users need them, and configure the matching app/client. The app explicitly supports Ethereum, Base, Arbitrum, Optimism and Polygon. Connect/create remains the existing Privy flow.
- `NEXT_PUBLIC_SUPABASE_URL` and server-only `SUPABASE_SERVICE_ROLE_KEY`; apply the existing database migrations, including optimistic `socialtrading_agent_save` revision handling. A persistence failure must prevent returning newly issued calldata.
- Server-only `UNISWAP_API_KEY` with Trading API access. Router header is pinned to `2.0`; `lib/crypto/permit.ts` pins the corresponding chain-specific router addresses. Update and test the header/address map together. No API keys reach the browser.
- Server-only `CRYPTO_RPC_URL_1`, `_8453`, `_42161`, `_10`, `_137` for the chains used. The RPC must support balances, contract calls, gas estimation, account nonces, transaction/receipt lookup and block lookup. An absent or wrong-chain endpoint blocks that chain.
- Keep existing market-data/valuation configuration. It cannot substitute for onchain token metadata or funds.
- `NEXT_PUBLIC_BUNDLER_URL` is now **legacy recovery only**, not required for new purchases. Keep the old endpoint if prior operations still need recovery. Never place a private credential in a `NEXT_PUBLIC` variable.

Users need the input asset and native ETH on Ethereum/Base/Arbitrum/Optimism, or POL on Polygon, in the **selected wallet on the selected chain**. Zero or insufficient estimated gas produces an actionable funding error before sending.

### Privy sponsorship

Sponsorship is **not enabled** and is never inferred from a chain list or environment flag. Privy's documented native sponsorship requires TEE execution/migration, funded billing, enabled sponsored chains, permission for client-originated transactions, and `useSendTransaction({…}, {sponsor: true})`. Dashboard access/configuration and compatible sponsored receipt semantics have not been established here. Simply adding `sponsor: true` to the EIP-1193 provider or old custom bundler would not enable it.

To add sponsorship, configure those dashboard prerequisites, implement a Privy sponsored-send adapter with explicit selected wallet/chain, and test authorization, approval sponsorship and receipt verification (including operation-based settlement) before relaxing native-gas checks. This release deliberately uses the supported native-gas fallback rather than reporting fictitious gasless execution.

### Dynamic

Not added. A future addition must be an actual opportunity → user delegation/approval → external policy check → Dynamic delegated execution → verified receipt workflow alongside Privy. It needs revocable wallet permissions and enforced chain/asset/type/transaction/daily/weekly limits outside the LLM. No environment keys or fake delegation controls have been added for an absent workflow.

## Validation

`npm test` covers lifecycle transitions, exact approvals and already-approved paths, Permit2 signing and quote binding, insufficient chain-specific USDC, wrong network, native gas, onchain decimals, rejected wallet signatures, stale quotes, RPC outages, reverts, account/network changes, nonce-bound retry, persistence failure, and exact transaction/receipt verification. Provider and RPC fixtures are test-only; no production success is mocked.

`LIVE=1 npm test -- lib/crypto/live.test.ts` makes read-only requests to the actual Uniswap gateway and configured Base RPC. It checks a $25 USDC→WETH quote, Permit2 validation, chain ID and decimals. This passed on September 17, 2026. It does **not** prove a funded swap, wallet-popup behavior, or mainnet settlement.

Before deploying broadly, use a funded Privy wallet for a small real purchase on each enabled chain: confirm each approval, sign the fresh permit and swap, then compare the recorded hash/receipt with the explorer. Exercise rejection and refresh/recovery as well. Do not report this live acceptance check as passed until its real receipt exists.

References:

- [Uniswap Permit2 workflow](https://developers.uniswap.org/docs/trading/swapping-api/concepts/permit2)
- [Uniswap integration guide](https://developers.uniswap.org/docs/trading/swapping-api/start-building/integration-guide)
- [Pinned Universal Router deployment sources](https://github.com/Uniswap/universal-router/tree/main/deploy-addresses)
- [Privy sponsorship setup](https://docs.privy.io/wallets/gas-and-asset-management/gas/setup)
