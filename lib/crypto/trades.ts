import "server-only";
import { cryptoServices } from "./services";
import { ownedWallet } from "./wallet";
import { address, chain, CHAINS, NATIVE, parseUnits, swapRequest } from "./chains";
import { preflight, tokenDecimals, approvalTransaction, checkTransactionGas } from "./preflight";
import { validatePermit, permitPayload } from "./permit";
import { verifyTypedData } from "viem";
import { tradePolicy } from "@/lib/socialtrading/policy";
import { recordEvent } from "@/lib/socialtrading/personalization";
import type { HubState, TradeInitiator, TradeIntent } from "@/lib/socialtrading/types";
import type { SwapRequest, TokenDisplay } from "./types";

/** A proposal that was never signed goes stale: quotes, prices, and the user's intent all move. */
export const PROPOSAL_TTL = 24 * 3600_000;
const usd = (n: number) => `$${n.toFixed(2)}`;

async function describe(services: typeof cryptoServices, chainId: number, token: string): Promise<TokenDisplay> {
  if (token === NATIVE) return { symbol: chain(chainId).nativeSymbol, decimals: 18 };
  try { const p = await services.defi?.price({ chainId, address: token }); if (p) return { symbol: p.symbol || "token", decimals: await tokenDecimals(chainId, token) }; } catch { /* display only */ }
  return { symbol: "token", decimals: null };
}

/** Creates a swap intent and runs the deterministic policy. The wallet must
 * belong to the user; the quote is read-only. Agent proposals in Act mode
 * reserve their allowance immediately; every swap still needs the user's
 * wallet signature because no delegated signer exists. */
export async function proposeSwap(state: HubState, userId: string, input: SwapRequest, reasoning: string, services = cryptoServices, initiator: TradeInitiator = "agent") {
  const request = swapRequest(input); await ownedWallet(userId, request.wallet);
  const [quote, value, tokenIn, tokenOut] = await Promise.all([
    services.execution.quote(request),
    services.valuation.value({ chainId: request.chainId, address: request.tokenIn }, request.amount),
    describe(services, request.chainId, request.tokenIn), describe(services, request.chainId, request.tokenOut),
  ]);
  const policy = tradePolicy(state.profile, value, state.trades, false, Date.now(), initiator), at = new Date().toISOString();
  const status: TradeIntent["status"] = policy.allowed ? "reserved" : policy.needsApproval ? "approval_required" : "blocked";
  const detail = status === "blocked" ? `Blocked: ${policy.reason}` : initiator === "user" ? "Review and sign with your wallet when you’re ready. Native network fees are additional." : status === "reserved" ? "Within your agent’s limits and reserved against them. It still settles only when you sign in your wallet." : "Waiting for you to review and sign in your wallet. Network fees are additional.";
  const trade: TradeIntent = { id: crypto.randomUUID(), initiator, asset: { id: `${request.chainId}:${request.tokenOut}`, symbol: tokenOut.symbol.toUpperCase(), name: `${tokenOut.symbol.toUpperCase()} on ${chain(request.chainId).name}`, kind: "crypto" }, side: "buy", value, estimatedPrice: null, estimatedQuantity: null, resultingExposure: null, createdAt: at, reasoning: reasoning.slice(0, 600), policy: { ...policy, at }, status,
    crypto: { request, outputAmount: quote.outputAmount, minimumOutput: quote.minimumOutput, expiresAt: quote.expiresAt, phase: "ready", detail, display: { tokenIn, tokenOut } } };
  state.trades.push(trade);
  recordEvent(state, "trade", `${initiator === "user" ? "You set up" : "Proposed"} a Uniswap swap for ${usd(value)} of ${trade.asset.symbol} on ${chain(request.chainId).name}`, detail, trade.id);
  return trade;
}

/** User-initiated swap from human units. Decimals come from the valuation
 * provider, never from the client, and the amount is converted exactly. */
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
  const funds = await preflight(c.request);
  if (c.display) {
    if (c.display.tokenIn.decimals !== null && c.display.tokenIn.decimals !== funds.inputDecimals) throw new Error("Token decimals changed. Request a new proposal.");
    c.display.tokenIn.decimals = funds.inputDecimals; c.display.tokenOut.decimals = funds.outputDecimals;
  }
  const value = await cryptoServices.valuation.value({ chainId: c.request.chainId, address: c.request.tokenIn }, c.request.amount);
  if (value > trade.value) throw new Error("The USD input value increased. Ask for a new swap proposal.");
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed) throw new Error(policy.reason);
  const approval = await approvalTransaction(c.request);
  const at = new Date().toISOString();
  trade.approval = { decision: "approved", at }; trade.policy = { ...policy, at };
  if (approval) {
    await checkTransactionGas(approval);
    await issue(trade, approval, "approval");
    return { transaction: approval, step: c.step, expiresAt: c.expiresAt };
  }
  // Only quote after every required approval is confirmed.
  const quote = await cryptoServices.execution.quote(c.request);
  if (BigInt(quote.minimumOutput) < BigInt(c.minimumOutput)) throw new Error("The quote moved below your minimum output. Ask for a new proposal.");
  c.quote = quote; c.quoteId = crypto.randomUUID(); c.expiresAt = quote.expiresAt;
  c.phase = "authorizing"; c.step = "swap";
  c.detail = quote.permitData ? "Sign the Permit2 authorization for this fresh quote." : "Fresh quote ready for swap creation.";
  return { permitData: quote.permitData, quoteId: c.quoteId, expiresAt: c.expiresAt, step: c.step };
}

async function issue(trade: TradeIntent, transaction: import('./types').Transaction, step: "approval" | "swap") {
  const c = trade.crypto!;
  const { rpc } = await import("./rpc");
  transaction.nonce = await rpc<string>(transaction.chainId, "eth_getTransactionCount", [transaction.from, "pending"]);
  if (!/^0x[0-9a-f]+$/i.test(transaction.nonce)) throw new Error("RPC returned an invalid transaction nonce.");
  trade.status = "unknown";
  c.phase = "issued"; c.step = step; c.transaction = transaction; c.batch = undefined; c.hash = undefined; c.userOpHash = undefined;
  // An approval does not depend on a swap quote's lifetime.
  if (step === "approval") c.expiresAt = Date.now() + 300_000;
  c.detail = step === "approval" ? "Token approval awaiting your wallet signature and onchain confirmation. This is not a purchase." : "Swap awaiting your wallet signature. Success requires onchain confirmation.";
}

export async function authorizeSwap(state: HubState, userId: string, trade: TradeIntent, quoteId: unknown, signature?: unknown) {
  const c = trade.crypto!;
  if (c.phase !== "authorizing" || !c.quote || c.quoteId !== quoteId || c.quote.expiresAt <= Date.now()) throw new Error("Quote expired or changed. Request a fresh quote.");
  await ownedWallet(userId, c.request.wallet);
  await preflight(c.request);
  const policy = tradePolicy(state.profile, trade.value, state.trades.filter(t => t.id !== trade.id), true, Date.now(), trade.initiator ?? "agent");
  if (!policy.allowed || (trade.initiator !== "user" && state.agent && !state.agent.capabilities.includes("trading"))) throw new Error("Trading authorization changed. Request a new proposal.");
  if (c.quote.permitData) {
    validatePermit(c.quote.permitData, c.request);
    if (typeof signature !== "string" || !/^0x[0-9a-f]{130}$/i.test(signature) || !await verifyTypedData({ ...permitPayload(c.quote.permitData), types: c.quote.permitData.types, address: c.request.wallet as `0x${string}`, signature: signature as `0x${string}` })) throw new Error("Invalid Permit2 signature for the selected wallet and quote.");
  }
  const transaction = await cryptoServices.execution.swap(c.quote, typeof signature === "string" ? signature : undefined);
  await checkTransactionGas(transaction);
  if (c.quote.expiresAt <= Date.now()) throw new Error("Quote expired. Request a fresh quote.");
  await issue(trade, transaction, "swap");
  c.quote = undefined;
  recordEvent(state, "trade", "Uniswap swap sent to your wallet for confirmation", undefined, trade.id);
  return { transaction, step: c.step, expiresAt: c.expiresAt };
}
