# Cross-network purchases

A purchase stops caring which network the user's money is on. Today a buy only
works when USDC already sits on the destination chain, which in practice means
Ethereum and a lot of dead ends. After this, the server finds the money
wherever it is, routes it, and the user still signs for one thing they asked
for: the asset.

The consumer promise the same-chain path already makes — the network fee comes
out of USDC, never native tokens — has to survive the crossing. A route that
demands ETH on every hop is the reason this does not feel like a consumer app,
so gasless is the design constraint, not a refinement.

## Decisions

- **Route discovery is server code, not a model decision.** Every buy runs
  `resolvePurchaseRoute` before a quote exists. The agent keeps a read-only
  tool so it can answer "can I afford this?" in chat, but no purchase depends
  on the model choosing to call it.
- **No network picker.** The source network is resolved, shown, and not
  offered as a choice. This follows the standing direction that the app owns
  these decisions rather than exposing them as settings.
- **Every step is a user operation.** A Uniswap `SEND_TX` step's payload is
  `{to, data, value}` — the same shape as `Call` in `lib/crypto/types.ts:10`.
  So each step wraps into a one-call `SwapBatch` and goes through the existing
  `sendSwapBatch` with Circle Paymaster. EIP-7702 keeps the address identical,
  so calldata that checks `msg.sender` still works. No step needs native gas.
- **Fees are reserved before quoting, not discovered after.** Circle Paymaster
  pulls its fee in postOp, after execution. A step that spends its whole USDC
  balance reverts. The bridge input is therefore sized down by the fee cap of
  each chain the route touches.
- **A route through an unplanned third chain is refused.** We reserved fees for
  the source and the destination. A plan that hops through a chain we did not
  fund would strand money mid-route, so it is rejected at proposal time.
- **`permitData` is always null on chained routes.** Uniswap's chained-actions
  guide is explicit about this, so nothing in this path reuses the Permit2
  flow that `lib/crypto/batch.ts` builds for same-chain swaps.

## What already exists

Work is in the tree, uncommitted, and is the baseline rather than a draft to
discard. `lib/crypto/bridges.ts` has `checkPurchaseRoutes`, `proposeBridge` and
`advanceBridge`. `lib/crypto/providers/uniswap-bridge.ts` is a correct client
for `POST /quote`, `POST /plan`, `GET /plan/{id}` and `PATCH /plan/{id}`, with
plan validation that pins the first step's input and the last step's output to
the request. `app/(hub)/_hub/bridge-trade-card.tsx` walks a plan step by step.
The `check_purchase_bridges` tool is registered in `lib/crypto/agent.ts:14`.

Three things are missing, and they are what this design adds: the route is
chosen by the user through a dropdown rather than by the server; every step
demands native gas; and anything that is not a `SEND_TX` step dead-ends at
`lib/crypto/bridges.ts:68` with "requires a wallet action Rubicon does not yet
support".

## The resolver — `lib/crypto/route-resolver.ts`

One exported function:

```ts
resolvePurchaseRoute(userId, { wallet, destinationChainId, tokenOut, amount })
```

It verifies wallet ownership once, then fans out across `CHAIN_IDS`. For each
chain it reads the USDC balance by `eth_call` against that chain's USDC
contract. The threshold differs by role, and the difference matters: the
destination chain needs `purchaseTotal(chainId, amount)` — the amount plus the
fee cap, as `lib/crypto/readiness.ts:26` already computes — because a
same-chain buy tops the fee up on the side. A source chain needs only `amount`,
because the fee comes out of the amount. A chain under its threshold is
`insufficient` and is not quoted.

The destination chain, if funded, is `same_chain` and wins outright — no bridge
is quoted at all, and the existing same-chain swap path in
`lib/crypto/trades.ts` handles it unchanged.

Otherwise each funded chain is quoted through the bridge provider, with the
fee-reserved input from the next section. Failures are caught per chain and
reported as `unavailable` with their reason; one provider error never fails the
others. Among `available` routes the cheapest `gasFeeUSD` wins, tie-broken by
lower `timeEstimateMs`, tie-broken by chain id for determinism.

The return value is the chosen route plus every rejected candidate and why. The
buy panel shows only the chosen one. The agent tool returns the whole list,
because explaining "your money is on Polygon but there's no route to this
token" is exactly what it is for.

`checkPurchaseRoutes` in `lib/crypto/bridges.ts` is replaced by this function.
Its per-chain fan-out and error isolation carry over; the scoring and the fee
reserve are new.

## The fee reserve — `lib/crypto/bridge-gas.ts`

`feeCap(chainId)` in `lib/crypto/chains.ts:27` already names what Circle's
Paymaster may pull on a chain. The reserve applies it twice:

```
bridgeInput = amount − feeCap(source) − feeCap(destination)
```

That leaves `feeCap(source)` of USDC sitting on the source chain to pay for the
bridge step, and arranges for `feeCap(destination)` of the arriving USDC to go
unspent so it can pay for the destination swap. Unspent allowance is refunded,
so both remainders settle as dust rather than loss.

The user-facing consequence is that a $50 buy spends $50 all in and receives
roughly $49.50 of the asset. The buy panel says exactly that before the user
commits. This is the honest version of a promise the same-chain path already
makes quietly through `purchaseTotal` in `lib/crypto/readiness.ts:26`, which
adds the fee cap on top of the amount; cross-network takes it out of the amount
instead, because there is no second chain to top up from.

Required source balance is therefore `amount`, not `amount + fees`. A wallet
holding exactly the purchase price can complete a cross-network buy.

**Small buys from expensive chains.** `feeCap(1)` is $16 — twice the $8 reserve
in `lib/crypto/chains.ts:18` — so a $10 buy funded from Ethereum has a negative
bridge input. The reserve is not a cost the route can absorb, so such a
candidate is not quoted: the resolver marks it `fee_exceeds_amount` and moves
on. If it was the only funded chain, the panel says the honest thing — that the
money is on Ethereum, that moving $10 of it costs more than $10, and which
network would work instead. The rollup caps are cents, so this only ever bites
mainnet-funded micro-buys. A route is also skipped when the reserved input
leaves less than a dollar to actually spend, because a route that delivers
nothing is not a route.

After the plan comes back, `assertFundedChains(plan, source, destination)`
walks every step's `tokenInChainId` and rejects the plan if any step would
execute on a chain that is neither. The message names the problem plainly and
nothing is issued.

## The step executor — `lib/crypto/bridge-steps.ts`

Replaces the single `SEND_TX` branch in `advanceBridge` with a mapping from a
plan step to a wallet action:

| Method | PayloadType | Action |
| --- | --- | --- |
| `SEND_TX` | `TX` | Payload becomes one `Call`; wrapped as a `SwapBatch` and sent as a user operation. Proof is the resulting transaction hash. |
| `SEND_CALLS` | `EIP_5792` | Payload's calls become the batch directly. Proof is the transaction hash. |
| `SIGN_MSG` | `EIP_712` | Typed data signed in the wallet, no gas, no transaction. Proof is the signature. |

The server still authorizes each step before any calldata leaves it: the chain
is supported, the `to` is not the zero address, the data is well-formed hex, and
the step's `from` and recipient are still the user's wallet. It records the
authorized batch the same way `prepareSwap` records one today, so the operation
that lands can be held to the calldata that was authorized.

Where a chain has no paymaster support, the step falls back to a native-gas
`eth_sendTransaction` exactly as it works now — but the requirement is stated on
the card before the user commits to the route, not discovered at step three. All
five supported chains are gasless today, so this is a guard, not a path.

Signature steps add a `signature` field alongside `txHash` in the PATCH proof
body, which the provider client already shapes correctly.

## The buy panel

`app/(hub)/_hub/buy-panel.tsx` loses the "Pay with USDC on" select, the "Find
funds on other networks" button, the `sourceChain` and `routes` state, and the
"Connect to {chain} / refresh funds" button as a required step.

What replaces them is one resolved line, live once an asset, amount and wallet
are chosen:

> Paying from Base → Arbitrum · about 2 min · ≈ $49.50 of TOKEN

While resolving it reads "Finding your funds…". If no route exists anywhere the
panel says which networks hold money and why none of them can reach this asset,
because that is actionable and a blank disabled button is not.

The trade card at `app/(hub)/_hub/bridge-trade-card.tsx` keeps its step list,
per-step explorer links and hash recovery. Its signing action routes through
`sendSwapBatch` instead of `eth_sendTransaction`, and it gains a case for
signature steps, which complete without a transaction and so have no explorer
link.

## Error handling

The existing invariants hold and are not relaxed:

- One issued step at a time. A second prepare while one is outstanding is
  refused.
- A resume re-checks the pending nonce before returning the same calldata, so a
  transaction that already landed is never reissued.
- A lost wallet response is recovered by pasting the hash, never by signing
  again.
- A step is complete when the chain says so, never because a poll returned.

Added:

- An unfunded third chain in the plan is refused at proposal time, before
  anything is signed.
- A route whose steps we cannot execute is refused at proposal time rather than
  mid-plan, so a user is never stranded holding an intermediate asset.
- When a route does fail after a completed step, the card already names what the
  last completed step delivered and where; that stays, and is the reason the
  third-chain check exists.

## Testing

Extending `lib/crypto/bridges.test.ts` and adding
`lib/crypto/route-resolver.test.ts`:

- Resolver prefers a funded destination chain over any bridge, and never quotes
  when it does.
- Scoring picks cheapest fee, then fastest, then lowest chain id, with a case
  for each tie-break.
- One chain's provider failure leaves the other candidates intact.
- Fee reserve arithmetic at the boundary: a wallet holding exactly `amount`
  resolves a route, and the bridge input is `amount` minus both caps.
- A buy smaller than the combined fee caps is not quoted, and a wallet funded
  only on such a chain gets the explanatory failure rather than a silent empty
  list.
- A plan touching a third chain is rejected and issues nothing.
- Each of the three step kinds produces the expected batch or signature request,
  and an unknown method is refused without issuing a transaction.
- Proof submission after a lost hash reaches the same terminal state as the
  normal path.

The route resolver's fan-out is tested against a stubbed fetcher, in the style
`bridges.test.ts` already uses, so no test reaches the network.
