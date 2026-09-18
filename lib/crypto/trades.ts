import "server-only";
import { cryptoServices } from "./services";
import { ownedWallet } from "./wallet";
import { address, chain, NATIVE, parseUnits, swapRequest } from "./chains";
import { BUY_CHAIN } from "./tradable";
import { preflight, tokenDecimals, tokenSymbol, approvalTransaction, checkTransactionGas } from "./preflight";
import { catalogEntry } from "./catalog";
import { buildSwapBatch, simulateSwapBatch, gaslessChain } from "./batch";
import { validatePermit, permitPayload } from "./permit";
import { verifyTypedData } from "viem";
import { tradePolicy } from "@/lib/socialtrading/policy";
import { recordEvent } from "@/lib/socialtrading/personalization";
import type { HubState, TradeInitiator, TradeIntent } from "@/lib/socialtrading/types";
import type { SwapBatch, SwapRequest, TokenDisplay, Transaction } from "./types";

/** A proposal that was never signed goes stale: quotes, prices, and the user's intent all move. */
export const PROPOSAL_TTL = 24 * 3600_000;
const usd = (n: number) => `$${n.toFixed(2)}`;

/** What a token is: the ticker to print, and where its decimal point sits.
 *
 * Identity is not a price, and asking a price feed for it fails in the one
 * case that matters most. DefiLlama refuses any quote older than five minutes,
 * which for a tokenized stock is most of the day once its market closes. The
 * whole answer — symbol and decimals together — used to be discarded when that
 * happened, leaving `{ symbol: "token", decimals: null }`, and `formatUnits`
 * with null decimals prints base units: a $0.50 buy of NVDAc read "227373
 * TOKEN" on the confirmation instead of 0.00227373.
 *
 * So identity comes from the sources that actually hold it. The catalog pin
 * first — every entry is held to the contract's own `symbol()` and
 * `decimals()` by scripts/verify-catalog.ts, and it is the only source that
 * keeps `NVDAc` from being flattened to `NVDAC`. Then the contract itself. A
 * price is consulted for nothing but a last-resort name. */
async function describe(services: typeof cryptoServices, chainId: number, token: string): Promise<TokenDisplay> {
  if (token === NATIVE) return { symbol: chain(chainId).nativeSymbol, decimals: 18 };
  const pinned = catalogEntry(chainId, token);
  if (pinned) return { symbol: pinned.symbol, decimals: pinned.decimals };
  const [symbol, decimals] = await Promise.all([
    tokenSymbol(chainId, token),
    // Unknown stays unknown. Assuming 18 misplaces the point exactly as badly
    // as printing base units, only without looking wrong.
    tokenDecimals(chainId, token).catch(() => null),
  ]);
  if (symbol) return { symbol, decimals };
  // The chain could not be reached. A stale quote still carries a usable name.
  try { const p = await services.defi?.price({ chainId, address: token }); if (p?.symbol) return { symbol: p.symbol, decimals }; } catch { /* display only */ }
  return { symbol: "token", decimals };
}

/** Creates a swap intent and runs the deterministic policy. The wallet must
 * belong to the user; the quote is read-only. Agent proposals in Act mode
 * reserve their allowance immediately; every swap still needs the user's
 * wallet signature because no delegated signer exists. */
export async function proposeSwap(state: HubState, userId: string, input: SwapRequest, reasoning: string, services = cryptoServices, initiator: TradeInitiator = "agent") {
  const request = swapRequest(input); await ownedWallet(userId, request.wallet);
  // Everything the agent buys settles on Base. This is enforced here rather than
  // in the prompt, because a scheduled run has no one to correct it: the cron
  // dispatcher reaches this same function, so the rule holds for every caller.
  if (initiator !== "user" && request.chainId !== BUY_CHAIN) throw new Error(`Rubicon buys on ${chain(BUY_CHAIN).name}. Propose this swap on ${chain(BUY_CHAIN).name}, or ask the user to buy it themselves.`);
  const [quote, value, tokenIn, tokenOut] = await Promise.all([
    services.execution.quote(request),
    services.valuation.value({ chainId: request.chainId, address: request.tokenIn }, request.amount),
    describe(services, request.chainId, request.tokenIn), describe(services, request.chainId, request.tokenOut),
  ]);
  const policy = tradePolicy(state.profile, value, state.trades, false, Date.now(), initiator), at = new Date().toISOString();
  const status: TradeIntent["status"] = policy.allowed ? "reserved" : policy.needsApproval ? "approval_required" : "blocked";
  // The fee sentence has to match the one the card prints above it: on a
  // sponsored chain nothing is "additional" — it comes out of the same USDC.
  const fee = gaslessChain(request.chainId) ? "The network fee comes out of your USDC." : `Network fees are paid in ${chain(request.chainId).nativeSymbol}.`;
  const detail = status === "blocked" ? `Blocked: ${policy.reason}`
    : initiator === "user" ? `Review and sign in your wallet when you’re ready. ${fee}`
    : status === "reserved" ? "Within your agent’s limits and reserved against them. It still settles only when you sign in your wallet."
    : `Waiting for you to review and sign in your wallet. ${fee}`;
  const trade: TradeIntent = { id: crypto.randomUUID(), initiator, asset: { id: `${request.chainId}:${request.tokenOut}`, symbol: tokenOut.symbol.toUpperCase(), name: `${tokenOut.symbol.toUpperCase()} on ${chain(request.chainId).name}`, kind: "crypto" }, side: "buy", value, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, createdAt: at, reasoning: reasoning.slice(0, 600), policy: { ...policy, at }, status,
    crypto: { request, outputAmount: quote.outputAmount, minimumOutput: quote.minimumOutput, expiresAt: quote.expiresAt, phase: "ready", detail, display: { tokenIn, tokenOut } } };
  state.trades.push(trade);
  recordEvent(state, "trade", `${initiator === "user" ? "You set up" : "Proposed"} a Uniswap swap for ${usd(value)} of ${trade.asset.symbol} on ${chain(request.chainId).name}`, detail, trade.id);
  return trade;
}

/** User-initiated swap from human units. Decimals come from the chain
 * contract, never from the client, and the amount is converted exactly. */
export async function userSwap(state: HubState, userId: string, input: Record<string, unknown>, services = cryptoServices) {
  const chainId = Number(input.chainId); chain(chainId);
  const tokenIn = address(input.tokenIn), tokenOut = address(input.tokenOut), wallet = address(input.wallet);
  const slippageBps = input.slippageBps === undefined ? 50 : Number(input.slippageBps);
  if (typeof input.amount !== "string") throw new Error("Enter an amount to spend.");
  await ownedWallet(userId, wallet);
  const decimals = await tokenDecimals(chainId, tokenIn);
  const amount = parseUnits(input.amount, decimals);
  return proposeSwap(state, userId, { chainId, tokenIn, tokenOut, wallet, amount, slippageBps }, typeof input.note === "string" ? input.note.slice(0, 600) : "Placed by you.", services, "user");
}

/** Call only from an authenticated user action. The route MUST save the reservation before returning calldata. */
export async function prepareSwap(state: HubState, userId: string, trade: TradeIntent) {
  const c = trade.crypto;
  if (!c || !["ready", "authorizing"].includes(c.phase) || !["approval_required", "reserved"].includes(trade.status)) throw new Error("This transaction was already issued or cannot be executed. Check its status.");
  if (Date.parse(trade.createdAt) < Date.now() - PROPOSAL_TTL) throw new Error("This proposal is more than a day old. Ask for a fresh one so the quote and limits are current.");
  if (trade.initiator !== "user" && state.agent && !state.agent.capabilities.includes("trading")) throw new Error("Trading is disabled for this agent.");
  await ownedWallet(userId, c.request.wallet);
  // Circle's Paymaster covers the fee on every chain it is deployed to, so the
  // wallet is never asked for native gas there.
  const sponsored = gaslessChain(c.request.chainId);
  const funds = await preflight(c.request, sponsored);
  if (c.display) {
    if (c.display.tokenIn.decimals !== null && c.display.tokenIn.decimals !== funds.inputDecimals) throw new Error("Token decimals changed. Request a new proposal.");
    c.display.tokenIn.decimals = funds.inputDecimals; c.display.tokenOut.decimals = funds.outputDecimals;
  }
  const value = await cryptoServices.valuation.value({ chainId: c.request.chainId, address: c.request.tokenIn }, c.request.amount);
  if (value > trade.value) throw new Error("The USD input value increased. Ask for a new swap proposal.");
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed) throw new Error(policy.reason);
  // A sponsored swap carries its own approvals inside the batch, so there is no
  // separate approval transaction to pay for, sign, or wait on.
  const approval = sponsored ? null : await approvalTransaction(c.request);
  const at = new Date().toISOString();
  trade.approval = { decision: "approved", at }; trade.policy = { ...policy, at };
  if (approval) {
    await checkTransactionGas(approval);
    await issue(trade, { transaction: approval }, "approval");
    return { transaction: approval, step: c.step, expiresAt: c.expiresAt };
  }
  // Only quote after every required approval is confirmed.
  const quote = await cryptoServices.execution.quote(c.request);
  if (BigInt(quote.minimumOutput) < BigInt(c.minimumOutput)) throw new Error("The quote moved below your minimum output. Ask for a new proposal.");
  c.quote = quote; c.quoteId = crypto.randomUUID(); c.expiresAt = quote.expiresAt;
  c.phase = "authorizing"; c.step = "swap";
  c.detail = !sponsored && quote.permitData ? "Sign the Permit2 authorization for this fresh quote." : "Fresh quote ready for swap creation.";
  return { permitData: sponsored ? undefined : quote.permitData, quoteId: c.quoteId, expiresAt: c.expiresAt, step: c.step };
}

/** Hands the client exactly one thing to sign, and records exactly what was
 * authorized. A batch settles as a user operation and has no transaction nonce
 * of its own — the bundler owns ordering — so only the EOA path reserves one. */
async function issue(trade: TradeIntent, payload: { transaction: Transaction } | { batch: SwapBatch }, step: "approval" | "swap") {
  const c = trade.crypto!;
  if ("transaction" in payload) {
    const { rpc } = await import("./rpc");
    payload.transaction.nonce = await rpc<string>(payload.transaction.chainId, "eth_getTransactionCount", [payload.transaction.from, "pending"]);
    if (!/^0x[0-9a-f]+$/i.test(payload.transaction.nonce)) throw new Error("RPC returned an invalid transaction nonce.");
  }
  if (step === "swap" && c.expiresAt <= Date.now()) throw new Error("Quote expired. Request a fresh quote.");
  trade.status = "unknown";
  c.phase = "issued"; c.step = step; c.hash = undefined; c.userOpHash = undefined;
  c.transaction = "transaction" in payload ? payload.transaction : undefined;
  c.batch = "batch" in payload ? payload.batch : undefined;
  // An approval does not depend on a swap quote's lifetime.
  if (step === "approval") c.expiresAt = Date.now() + 300_000;
  c.detail = step === "approval" ? "Token approval awaiting your wallet signature and onchain confirmation. This is not a purchase."
    : c.batch ? "Swap awaiting your wallet signature. The network fee comes out of your USDC. Success requires onchain confirmation."
    : "Swap awaiting your wallet signature. Success requires onchain confirmation.";
}

export async function authorizeSwap(state: HubState, userId: string, trade: TradeIntent, quoteId: unknown, signature?: unknown) {
  const c = trade.crypto!;
  if (c.phase !== "authorizing" || !c.quote || c.quoteId !== quoteId || c.quote.expiresAt <= Date.now()) throw new Error("Quote expired or changed. Request a fresh quote.");
  await ownedWallet(userId, c.request.wallet);
  const sponsored = gaslessChain(c.request.chainId);
  await preflight(c.request, sponsored);
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed || (trade.initiator !== "user" && state.agent && !state.agent.capabilities.includes("trading"))) throw new Error("Trading authorization changed. Request a new proposal.");
  if (!sponsored && c.quote.permitData) {
    validatePermit(c.quote.permitData, c.request);
    if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature) || !await verifyTypedData({ ...permitPayload(c.quote.permitData), types: c.quote.permitData.types, address: c.request.wallet as `0x${string}`, signature: signature as `0x${string}` })) throw new Error("Invalid Permit2 signature for the selected wallet and quote.");
  }
  // The batch grants both approval layers itself. A separate Permit2 signature
  // is unnecessary, and a standalone swap simulation cannot see those approvals.
  const transaction = await cryptoServices.execution.swap(c.quote, typeof signature === "string" ? signature : undefined, { batchedApprovals: sponsored });
  // The batch is built from the router call the quote produced, so the calldata
  // the chain is later held to is the calldata authorized here and nothing else.
  const batch = sponsored ? await buildSwapBatch(c.request, transaction) : null;
  if (batch) await simulateSwapBatch(batch);
  else await checkTransactionGas(transaction);
  if (c.quote.expiresAt <= Date.now()) throw new Error("Quote expired. Request a fresh quote.");
  await issue(trade, batch ? { batch } : { transaction }, "swap");
  c.quote = undefined;
  recordEvent(state, "trade", "Uniswap swap sent to your wallet for confirmation", undefined, trade.id);
  return { ...(batch ? { batch } : { transaction }), step: c.step, expiresAt: c.expiresAt };
}

/** A retry reuses the exact issued calldata AND nonce; it can never execute twice.
 * No new quote or transaction is issued while a broadcast outcome is uncertain. */
export async function resumeSwap(state: HubState, userId: string, trade: TradeIntent) {
  const c = trade.crypto!;
  if (c.phase !== "issued" || c.hash || c.batch || !c.transaction?.nonce) throw new Error("Recover the transaction hash from your wallet and check its status.");
  if (c.expiresAt <= Date.now()) throw new Error("Quote expired. Recover the transaction status; do not resend this transaction.");
  await ownedWallet(userId, c.request.wallet);
  await preflight(c.request, gaslessChain(c.request.chainId));
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed || (trade.initiator !== "user" && state.agent && !state.agent.capabilities.includes("trading"))) throw new Error("Trading authorization changed.");
  const { rpc } = await import("./rpc");
  const nonce = await rpc<string>(c.request.chainId, "eth_getTransactionCount", [c.request.wallet, "pending"]);
  if (BigInt(nonce) !== BigInt(c.transaction.nonce)) throw new Error("A wallet transaction is already pending or confirmed. Recover its hash before continuing.");
  await checkTransactionGas(c.transaction);
  return { transaction: c.transaction, step: c.step, expiresAt: c.expiresAt };
}
