import { authenticate, bodyOf, failure, HubError, loadState, requestedAgent, saveState } from "@/lib/socialtrading/server";
import { prepareSwap, userSwap } from "@/lib/crypto/trades";
import { verifyTransaction } from "@/lib/crypto/rpc";
import { userWallets } from "@/lib/crypto/wallet";
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
    if (body.action === "propose") {
      // The user's own swap: their decision, their signature. Agent mode does not gate it.
      const trade = await userSwap(state, userId, body);
      return Response.json({ state: await saveState(userId, state), tradeId: trade.id });
    }
    if (typeof body.tradeId !== "string") throw new HubError(400, "Choose a swap proposal.");
    const trade = state.trades.find(t => t.id === body.tradeId), c = trade?.crypto;
    if (!trade || !c) throw new HubError(404, "Swap not found.");
    if (body.action === "prepare") {
      const transaction = await prepareSwap(state, userId, trade);
      // Optimistic revision update is the cross-process claim: only one caller receives calldata.
      await saveState(userId, state);
      return Response.json({ state, transaction, step: c.step, expiresAt: c.expiresAt });
    }
    if (body.action === "reject") {
      if (trade.status !== "rejected") {
        if (c.phase !== "ready" || !["approval_required", "reserved"].includes(trade.status)) throw new HubError(409, "This swap can no longer be declined. Check its status.");
        trade.status = "rejected"; trade.approval = { decision: "rejected", at: new Date().toISOString() }; c.detail = "Declined. Nothing was sent to your wallet and no allowance is held.";
        recordEvent(state, "trade", `You declined the ${trade.asset.symbol} swap`, undefined, trade.id);
      }
    } else if (body.action === "submitted") {
      if (c.phase !== "issued" || typeof body.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.hash) || (c.hash && c.hash !== body.hash)) throw new HubError(409, "Invalid or conflicting transaction hash.");
      // A client hash is only a claim. Receipt verification is required to release or confirm funds.
      c.hash = body.hash; c.detail = "Transaction hash received; awaiting onchain verification.";
    } else if (body.action === "status") {
      if (c.phase !== "issued" || !c.transaction || !c.hash) throw new HubError(409, "No transaction hash is recorded. Recover the hash from your wallet before retrying.");
      const result = await verifyTransaction(c.transaction, c.hash);
      if (result === "confirmed") {
        if (c.step === "swap") { c.phase = "complete"; trade.status = "confirmed"; c.detail = "Swap confirmed onchain."; }
        else { c.phase = "ready"; trade.status = "reserved"; c.detail = "Token approval confirmed. Continue to review and sign the swap itself."; }
        recordEvent(state, "trade", c.detail, c.hash, trade.id);
      } else if (result === "reverted") { c.phase = "complete"; trade.status = "failed"; c.detail = "Transaction reverted onchain. Network fees may have been charged."; recordEvent(state, "trade", `The ${trade.asset.symbol} swap reverted onchain`, c.hash, trade.id); }
      else c.detail = "Waiting for the transaction and two block confirmations.";
    } else throw new HubError(400, "Unknown swap action.");
    return Response.json({ state: await saveState(userId, state) });
  } catch (error) { return failure(error instanceof HubError ? error : new HubError(502, error instanceof Error ? error.message : "Crypto request failed.")); }
}
