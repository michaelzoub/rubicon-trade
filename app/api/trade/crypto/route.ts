import { advanceBridge, proposeBridge } from "@/lib/crypto/bridges";
import { resolvePurchaseRoute } from "@/lib/crypto/route-resolver";
import { findHoldings, transferCall } from "@/lib/crypto/recovery";
import { authenticate, bodyOf, failure, HubError, loadState, requestedAgent, saveState } from "@/lib/socialtrading/server";
import { authorizeSwap, prepareSwap, resumeSwap, userSwap } from "@/lib/crypto/trades";
import { rpc as rpcCall, verifyTransaction, verifyUserOperation } from "@/lib/crypto/rpc";
import { ownedWallet, userWallets } from "@/lib/crypto/wallet";
import { chain } from "@/lib/crypto/chains";
import { cryptoServices } from "@/lib/crypto/services";
import { normalizeMatches } from "@/lib/crypto/search";
import { recordEvent } from "@/lib/socialtrading/personalization";
export const runtime = "nodejs";
export const maxDuration = 60;

/** `?q=` searches buyable tokens on supported chains (DexScreener, deepest pair per token).
 * Otherwise lists the wallets Privy has verified for this user; only these may be quoted or signed for. */
export async function GET(request: Request) {
  try {
    const userId = await authenticate(request), q = new URL(request.url).searchParams.get("q");
    if (q !== null) {
      const query = q.trim().slice(0, 100);
      if (!query) return Response.json({ tokens: [] });
      return Response.json({ tokens: normalizeMatches(await cryptoServices.discovery.search(query), query), fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ wallets: await userWallets(userId) }, { headers: { "Cache-Control": "no-store" } });
  }
  catch (error) { return failure(error instanceof HubError ? error : new HubError(502, error instanceof Error ? error.message : "Wallets could not be loaded.")); }
}

export async function POST(request: Request) {
  try {
    const userId = await authenticate(request), body = await bodyOf(request);
    const state = await loadState(userId, requestedAgent(body.agentId));
    if (!state) throw new HubError(404, "Workspace not found.");
    if (body.revision !== state.revision) throw new HubError(409, "Your workspace changed. Refresh and try again.");
    if (body.action === "holdings") {
      // Read-only: reports what is sitting where. Moving any of it is a
      // transaction the user signs in their own wallet.
      const wallets = await userWallets(userId);
      const extra = Array.isArray(body.extra) ? (body.extra as { chainId: number; token: string }[]).slice(0, 5) : undefined;
      return Response.json({ holdings: await findHoldings(userId, wallets, state, extra) });
    }
    if (body.action === "withdraw") {
      const wallet = String(body.wallet);
      await ownedWallet(userId, wallet);
      const chainId = Number(body.chainId);
      chain(chainId);
      const call = transferCall(String(body.token), String(body.to), String(body.amount));
      // The nonce is reserved here, exactly as a swap's is, so a lost wallet
      // response can never be resent as a second transfer.
      const nonce = await rpcCall<string>(chainId, "eth_getTransactionCount", [wallet, "pending"]);
      if (!/^0x[0-9a-f]+$/i.test(nonce)) throw new HubError(502, "Could not prepare the transfer. Try again.");
      return Response.json({ transaction: { chainId, from: wallet, ...call, nonce } });
    }
    if (body.action === "purchase_route") {
      // The wallets are whatever Privy has verified for this user, never a client claim.
      const wallets = await userWallets(userId);
      return Response.json({ route: await resolvePurchaseRoute(userId, { wallets, destinationChainId: Number(body.destinationChainId), tokenOut: String(body.tokenOut), amount: String(body.amount) }) });
    }
    if (body.action === "propose") {
      // The user's own swap: their decision, their signature. Agent mode does not gate it.
      const trade = body.destinationChainId !== undefined && Number(body.destinationChainId) !== Number(body.chainId) ? await proposeBridge(state, userId, body) : await userSwap(state, userId, body);
      return Response.json({ state: await saveState(userId, state), tradeId: trade.id });
    }
    if (typeof body.tradeId !== "string") throw new HubError(400, "Choose a swap proposal.");
    const trade = state.trades.find(t => t.id === body.tradeId), c = trade?.crypto;
    if (!trade || !c) throw new HubError(404, "Swap not found.");
    if (c.bridge) {
      const result = await advanceBridge(state, userId, trade, body);
      return Response.json({ state: await saveState(userId, state), ...result });
    }
    if (body.action === "prepare") {
      const result = await prepareSwap(state, userId, trade);
      // Optimistic revision update is the cross-process claim: only one caller receives calldata.
      await saveState(userId, state);
      return Response.json({ state, ...result });
    }
    if (body.action === "resume") {
      return Response.json({ state, ...await resumeSwap(state, userId, trade) });
    }
    if (body.action === "authorize") {
      const result = await authorizeSwap(state, userId, trade, body.quoteId, body.signature);
      await saveState(userId, state);
      return Response.json({ state, ...result });
    }
    if (body.action === "reject") {
      if (trade.status !== "rejected") {
        if (!["ready", "authorizing"].includes(c.phase) || !["approval_required", "reserved"].includes(trade.status)) throw new HubError(409, "This swap can no longer be declined. Check its status.");
        trade.status = "rejected"; trade.approval = { decision: "rejected", at: new Date().toISOString() }; c.detail = c.history?.length ? "Purchase declined. No swap was issued. Confirmed token approvals remain onchain." : "Declined. No transaction was issued for this purchase.";
        recordEvent(state, "trade", `You declined the ${trade.asset.symbol} swap`, undefined, trade.id);
      }
    } else if (body.action === "submitted") {
      const userOpHash = body.userOpHash;
      const hash = typeof body.hash === "string" ? body.hash.toLowerCase() : "";
      if (c.phase !== "issued" || !/^0x[0-9a-f]{64}$/.test(hash) || (c.hash && c.hash.toLowerCase() !== hash)) throw new HubError(409, "Invalid or conflicting transaction hash.");
      // The batch settled as a user operation, so its own hash is what identifies
      // it inside the bundler's transaction. Without it nothing can be verified.
      // Optional: a hash recovered by hand from a wallet will not have one, and
      // verification can still identify the operation from the batch itself.
      if (c.batch && userOpHash !== undefined) {
        if (typeof userOpHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(userOpHash) || (c.userOpHash && c.userOpHash !== userOpHash)) throw new HubError(409, "Invalid or conflicting user operation hash.");
        c.userOpHash = userOpHash;
      }
      if (state.trades.some(other => other.id !== trade.id && (other.crypto?.hash?.toLowerCase() === hash || other.crypto?.history?.some(entry => entry.hash.toLowerCase() === hash)))) throw new HubError(409, "This transaction hash is already recorded for another purchase.");
      // A client hash is only a claim. Receipt verification is required to release or confirm funds.
      c.hash = hash; c.detail = "Transaction hash received; awaiting onchain verification.";
    } else if (body.action === "status") {
      if (c.phase !== "issued" || !(c.batch ?? c.transaction) || !c.hash) throw new HubError(409, "No transaction hash is recorded. Recover the hash from your wallet before retrying.");
      const result = c.batch
        ? await verifyUserOperation(c.batch, c.userOpHash, c.hash)
        : await verifyTransaction(c.transaction!, c.hash);
      if (result === "confirmed") {
        const confirmedHash = c.hash;
        (c.history ??= []).push({ step: c.step ?? "swap", hash: c.hash, result });
        if (c.step === "approval") {
          c.phase = "ready"; trade.status = "reserved"; c.hash = undefined; c.transaction = undefined;
          c.quote = undefined; c.quoteId = undefined;
          c.detail = "Token approval confirmed. Continue to get a fresh quote and sign the purchase.";
        } else { c.phase = "complete"; trade.status = "confirmed"; c.detail = "Swap confirmed onchain."; }
        recordEvent(state, "trade", c.detail, confirmedHash, trade.id);
      } else if (result === "reverted") { (c.history ??= []).push({ step: c.step ?? "swap", hash: c.hash, result }); c.phase = "complete"; trade.status = "failed"; c.detail = "Transaction reverted onchain. Network fees may have been charged."; recordEvent(state, "trade", `The ${trade.asset.symbol} swap reverted onchain`, c.hash, trade.id); }
      else c.detail = "Waiting for the transaction and two block confirmations.";
    } else throw new HubError(400, "Unknown swap action.");
    return Response.json({ state: await saveState(userId, state) });
  } catch (error) { return failure(error instanceof HubError ? error : new HubError(502, error instanceof Error ? error.message : "Crypto request failed.")); }
}
