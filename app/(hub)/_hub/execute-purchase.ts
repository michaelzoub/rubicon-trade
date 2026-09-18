"use client";

import { chain } from "@/lib/crypto/chains";
import { sendSwapBatch, type SignAuthorization, type WalletProvider } from "@/lib/crypto/gasless";
import { readPurchaseBalance } from "@/lib/crypto/readiness";
import { assertWallet, signPurchasePermit, sendPurchaseTransaction } from "@/lib/crypto/purchase-client";
import type { TradeIntent } from "@/lib/socialtrading/types";
import type { CryptoAction, CryptoResult } from "./client";

/** Where a purchase has got to. Named rather than written out, because the
 * trade card and the buy panel say the same steps in very different voices —
 * one is a record, the other is a moment — and only the copy should differ. */
export type PurchaseStage =
  | { kind: "switching"; network: string }
  | { kind: "checking" }
  | { kind: "quoting" }
  | { kind: "permit" }
  | { kind: "authorizing" }
  | { kind: "signing" }
  | { kind: "submitted" }
  | { kind: "broadcast" };

/** What Privy hands back for a connected wallet, reduced to what signing needs. */
export type PurchaseWallet = { address: string; switchChain: (chainId: number) => Promise<void>; getEthereumProvider: () => Promise<unknown> };

export type PurchaseContext = {
  crypto: (action: CryptoAction) => Promise<CryptoResult>;
  signAuthorization: SignAuthorization;
  /** Read at the moment it is needed: switching networks republishes the list,
   * and a provider captured before the switch still points at the old chain. */
  wallets: () => PurchaseWallet[];
  onStage?: (stage: PurchaseStage) => void;
  /** The bundler has the operation. Recorded the instant that is true, so a lost
   * receipt is recoverable rather than a purchase nobody can account for. */
  onSubmitted?: (userOpHash: string, step: string) => void;
  onHash?: (hash: string, step: string) => void;
  onFunds?: (line: string) => void;
};

/** Everything between "yes, buy it" and a hash the server will verify.
 *
 * One signature in the common case: Circle's Paymaster pays the network fee out
 * of the same USDC, so the batch carries its own approvals and there is nothing
 * to approve first. The server has already held this to the quote, the policy
 * limits and the user's own wallet — this function adds no authority of its
 * own, it only carries the calldata to the wallet and the hash back. */
export async function executePurchase(trade: TradeIntent, action: "prepare" | "resume", ctx: PurchaseContext): Promise<{ hash: string; step: string }> {
  const r = trade.crypto!.request, net = chain(r.chainId);
  const stage = (s: PurchaseStage) => ctx.onStage?.(s);
  const found = () => ctx.wallets().find(w => w.address.toLowerCase() === r.wallet.toLowerCase());

  const wallet = found();
  if (!wallet) throw new Error("Connect the wallet that holds your funds to continue.");
  let provider = await wallet.getEthereumProvider() as WalletProvider;

  if (Number(await provider.request({ method: "eth_chainId" })) !== r.chainId) {
    stage({ kind: "switching", network: net.name });
    await wallet.switchChain(r.chainId);
    // Embedded switchChain resolves after scheduling React state. The old
    // wallet's provider factory still captures the previous chain, so read the
    // latest list while Privy publishes its update.
    for (let attempt = 0; attempt < 40; attempt++) {
      const updated = found();
      if (!updated) throw new Error("Reconnect the selected wallet before continuing.");
      provider = await updated.getEthereumProvider() as WalletProvider;
      if (Number(await provider.request({ method: "eth_chainId" })) === r.chainId) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  stage({ kind: "checking" });
  await assertWallet(provider, r);
  const balance = await readPurchaseBalance(provider, r.wallet, r.chainId);
  ctx.onFunds?.(`${Number(balance.usdc) / 1e6} USDC · ${Number(balance.native) / 1e18} ${net.nativeSymbol} on ${net.name}`);

  stage({ kind: "quoting" });
  let result = await ctx.crypto({ action, tradeId: trade.id });
  if (result.quoteId) {
    let signature: string | undefined;
    if (result.permitData) {
      stage({ kind: "permit" });
      signature = await signPurchasePermit(provider, r, result.permitData, result.expiresAt!);
    }
    await assertWallet(provider, r, result.expiresAt);
    stage({ kind: "authorizing" });
    result = await ctx.crypto({ action: "authorize", tradeId: trade.id, quoteId: result.quoteId, signature });
  }
  if (!result.expiresAt || !(result.batch ?? result.transaction)) throw new Error("No authorized transaction was returned.");

  const step = result.step ?? "swap";
  let hash: string, userOpHash: string | undefined;
  if (result.batch) {
    // One signature covers the approvals and the swap together, and the network
    // fee is taken from USDC rather than from an ETH balance the wallet does
    // not have.
    stage({ kind: "signing" });
    const sent = await sendSwapBatch({
      batch: result.batch, provider, signAuthorization: ctx.signAuthorization, expiresAt: result.expiresAt,
      onSubmitted: op => { ctx.onSubmitted?.(op, step); stage({ kind: "submitted" }); },
    });
    hash = sent.hash; userOpHash = sent.userOpHash;
  } else {
    stage({ kind: "signing" });
    hash = await sendPurchaseTransaction(provider, r, result.transaction!, result.expiresAt);
  }

  stage({ kind: "broadcast" });
  ctx.onHash?.(hash, step);
  await ctx.crypto({ action: "submitted", tradeId: trade.id, hash, ...(userOpHash ? { userOpHash } : {}) });
  await ctx.crypto({ action: "status", tradeId: trade.id });
  return { hash, step };
}
