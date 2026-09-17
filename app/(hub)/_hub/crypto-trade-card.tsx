"use client";
import { usePrivy, useSign7702Authorization, useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TradeIntent } from "@/lib/socialtrading/types";
import { chain, explorerAddress, explorerTx, formatUnits, gaslessChain, shortAddress } from "@/lib/crypto/chains";
import { recoverSwapOperation, sendSwapBatch, type SignAuthorization, type WalletProvider } from "@/lib/crypto/gasless";
import { readPurchaseBalance, purchaseError } from "@/lib/crypto/readiness";
import { assertWallet, signPurchasePermit, sendPurchaseTransaction } from "@/lib/crypto/purchase-client";
import { timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";

export function cryptoStatus(trade: TradeIntent): string {
  const c = trade.crypto!;
  switch (trade.status) {
    case "blocked": return "Not allowed";
    case "approval_required": return "Waiting for your signature";
    case "reserved": return c.step === "approval" ? "Approval confirmed · continue purchase" : trade.initiator === "user" ? "Ready to sign" : "Within limits · sign to settle";
    case "unknown": return c.hash ? "Verifying onchain" : "Sent to your wallet";
    case "confirmed": return "Confirmed onchain";
    case "rejected": return "Declined";
    case "failed": return "Reverted onchain";
    default: return trade.status;
  }
}

export function CryptoTradeCard({ trade, expanded = false }: { trade: TradeIntent; expanded?: boolean }) {
  const { state, crypto, busy: chatting } = useHub(), { connectWallet } = usePrivy(), { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  const [stage, setStage] = useState("");
  const [funds, setFunds] = useState("");
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovery, setRecovery] = useState(""), [raw, setRaw] = useState(false);
  const lock = useRef(false), c = trade.crypto!, r = c.request, net = chain(r.chainId);
  const tokenIn = c.display?.tokenIn ?? { symbol: shortAddress(r.tokenIn), decimals: null }, tokenOut = c.display?.tokenOut ?? { symbol: shortAddress(r.tokenOut), decimals: null };
  const wallet = wallets.find(w => w.address.toLowerCase() === r.wallet.toLowerCase());
  const storageKey = `rubicon:swap:${state.profile.userId}:${trade.id}:${c.step ?? "next"}`;
  useEffect(() => {
    try { setOperation(localStorage.getItem(`${storageKey}:operation`) ?? ""); setRecovery(localStorage.getItem(storageKey) ?? ""); } catch { /* storage optional */ }
  }, [storageKey]);
  const open = ["ready", "authorizing"].includes(c.phase) && ["approval_required", "reserved"].includes(trade.status);

  async function act(action: "prepare" | "resume" | "reject" | "status" | "recover" | "operation") {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      if (action === "prepare" || action === "resume") {
        if (!wallet) throw new Error(`Connect the wallet ${shortAddress(r.wallet)} to sign this swap.`);
        const provider = await wallet.getEthereumProvider() as WalletProvider;
        setStage("Checking wallet and funds…");
        await assertWallet(provider, r);
        const balance = await readPurchaseBalance(provider, r.wallet, r.chainId);
        setFunds(`${Number(balance.usdc) / 1e6} USDC · ${Number(balance.native) / 1e18} ${net.nativeSymbol} on ${net.name}`);
        setStage("Checking approvals and refreshing quote…");
        let result = await crypto({ action, tradeId: trade.id });
        if (result.quoteId) {
          let signature: string | undefined;
          if (result.permitData) {
            setStage("Sign Permit2 authorization…");
            signature = await signPurchasePermit(provider, r, result.permitData, result.expiresAt!);
          }
          await assertWallet(provider, r, result.expiresAt);
          setStage("Creating and simulating swap…");
          result = await crypto({ action: "authorize", tradeId: trade.id, quoteId: result.quoteId, signature });
        }
        if (!result.expiresAt || !(result.batch ?? result.transaction)) throw new Error("No authorized transaction was returned.");
        const key = `rubicon:swap:${state.profile.userId}:${trade.id}:${result.step}`;
        let hash: string, userOpHash: string | undefined;
        if (result.batch) {
          // One signature covers the approvals and the swap together, and the
          // network fee is taken from USDC rather than from an ETH balance the
          // wallet does not have.
          setStage("Sign purchase · network fee paid in USDC…");
          const sent = await sendSwapBatch({
            batch: result.batch, provider, signAuthorization: signAuthorization as SignAuthorization,
            expiresAt: result.expiresAt,
            // Recorded the moment the bundler accepts it, so a lost receipt is
            // still recoverable instead of leaving the purchase unaccounted for.
            onSubmitted: op => { setOperation(op); setStage("Submitted · awaiting confirmation…"); try { localStorage.setItem(`${key}:operation`, op); } catch { /* reference stays on screen */ } },
          });
          hash = sent.hash; userOpHash = sent.userOpHash;
        } else {
          setStage(result.step === "approval" ? "Sign token approval…" : "Sign swap transaction…");
          hash = await sendPurchaseTransaction(provider, r, result.transaction!, result.expiresAt);
        }
        setRecovery(hash); setStage("Broadcast · awaiting confirmation…");
        try { localStorage.setItem(key, hash); } catch { /* Hash remains visible. */ }
        await crypto({ action: "submitted", tradeId: trade.id, hash, ...(userOpHash ? { userOpHash } : {}) });
        await crypto({ action: "status", tradeId: trade.id });
      } else if (action === "operation") {
        const hash = await recoverSwapOperation(r.chainId, operation);
        if (!hash) { setError("Still waiting for network confirmation. Check again shortly; do not submit another purchase."); return; }
        setRecovery(hash);
        await crypto({ action: "submitted", tradeId: trade.id, hash, userOpHash: operation });
        await crypto({ action: "status", tradeId: trade.id });
      } else if (action === "recover") {
        let hash = recovery.trim(); try { hash ||= localStorage.getItem(storageKey) ?? ""; } catch { /* no storage */ }
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Paste the 66-character transaction hash from your wallet.");
        await crypto({ action: "submitted", tradeId: trade.id, hash }); await crypto({ action: "status", tradeId: trade.id });
      } else await crypto({ action, tradeId: trade.id });
    } catch (e) { setError(purchaseError(e)); }
    finally { lock.current = false; setBusy(false); }
  }

  useEffect(() => {
    if (c.phase !== "issued" || !c.hash) return;
    const timer = setInterval(() => { if (!lock.current) void act("status"); }, 8000);
    return () => clearInterval(timer);
    // The action always verifies the server's recorded transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.phase, c.hash, trade.id]);

  return <div className={`hub-trade hub-trade--crypto is-${trade.status}${open ? " hub-priority-card" : ""}`} role="group" aria-label="Onchain swap">
    <div className="hub-trade-head">
      <p className="hub-part-title">Swap · Uniswap on {net.name}</p>
      <span className="hub-trade-status">{cryptoStatus(trade)}</span>
    </div>
    <p className="hub-trade-byline">{trade.initiator === "user" ? "Placed by you" : `Proposed by ${state.agent?.name ?? "your agent"}`} · {timeAgo(trade.createdAt)}</p>
    {/* The trade in one line. Wallet, slippage and the exact minimum are real
      * but secondary, so they wait behind Details rather than competing with
      * the only question the card actually asks: do you want this? */}
    <p className="hub-trade-line">
      <span className="hub-trade-line-out">{formatUnits(r.amount, tokenIn.decimals)} {tokenIn.symbol.toUpperCase()}</span>
      <span className="hub-trade-line-arrow" aria-hidden="true">→</span>
      <span className="hub-trade-line-in">{formatUnits(c.outputAmount, tokenOut.decimals)} {tokenOut.symbol.toUpperCase()}</span>
      <small>≈ {usd(trade.value, 2)} · network fee paid in {gaslessChain(r.chainId) ? "USDC" : net.nativeSymbol}</small>
    </p>
    <div className="purchase-readiness"><strong>{net.name} · {shortAddress(r.wallet)}</strong><p>Receive at least {formatUnits(c.minimumOutput, tokenOut.decimals)} {tokenOut.symbol.toUpperCase()} · {r.slippageBps / 100}% maximum slippage</p><p>{funds || "Wallet and network funds are checked again before signing."}</p><p role="status">{busy ? stage : cryptoStatus(trade)}</p></div>
    {operation && <p className="purchase-requirements">Submitted operation: <span className="mono">{operation}</span>. Keep this reference if confirmation takes longer. <button type="button" className="hub-chip-button" disabled={busy} onClick={() => void act("operation")}>Check submitted purchase</button></p>}
    {trade.reasoning && <p className="hub-trade-reasoning">{trade.reasoning}</p>}
    <p className="hub-trade-policy">{trade.policy.reason}</p>
    <p className="hub-trade-brokerage">{c.detail}</p>
    {c.history?.map((entry, i) => <p className="hub-trade-brokerage" key={`${entry.hash}:${i}`}>{entry.step === "approval" ? "Token approval" : "Swap"} {entry.result}: <a className="mono hub-inline-link" href={explorerTx(r.chainId, entry.hash)} target="_blank" rel="noopener noreferrer">{entry.hash}</a></p>)}
    {c.hash && <p className="hub-trade-brokerage">Transaction <a className="mono hub-inline-link" href={explorerTx(r.chainId, c.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(c.hash)}<ArrowUpRight size={12} aria-hidden="true" /></a></p>}
    <details className="hub-disclosure hub-trade-disclosure" open={expanded}>
      <summary>Details</summary>
      <div className="hub-disclosure-body">
        <dl className="hub-trade-facts">
          <div><dt>You receive at least</dt><dd>{formatUnits(c.minimumOutput, tokenOut.decimals)} {tokenOut.symbol.toUpperCase()}<small>expected {formatUnits(c.outputAmount, tokenOut.decimals)}</small></dd></div>
          <div><dt>From wallet</dt><dd><a className="mono" href={explorerAddress(r.chainId, r.wallet)} target="_blank" rel="noopener noreferrer">{shortAddress(r.wallet)}</a><small>{wallet ? "connected" : "not connected"}</small></dd></div>
          <div><dt>Slippage</dt><dd>{r.slippageBps / 100}%</dd></div>
          <div><dt>Network</dt><dd>{net.name} · Uniswap</dd></div>
        </dl>
        <button type="button" className="hub-trade-raw-toggle" aria-expanded={raw} onClick={() => setRaw(v => !v)}><ChevronDown size={12} aria-hidden="true" />{raw ? "Hide" : "Show"} contract addresses</button>
        {raw && <dl className="hub-trade-raw mono">
          <div><dt>Pay token</dt><dd><a href={explorerAddress(r.chainId, r.tokenIn)} target="_blank" rel="noopener noreferrer">{r.tokenIn}</a></dd></div>
          <div><dt>Receive token</dt><dd><a href={explorerAddress(r.chainId, r.tokenOut)} target="_blank" rel="noopener noreferrer">{r.tokenOut}</a></dd></div>
          <div><dt>Base units</dt><dd>{r.amount} → ≥ {c.minimumOutput}</dd></div>
        </dl>}
      </div>
    </details>
    {error && <p className="hub-error" role="alert">{error}</p>}
    {open && <div className="hub-trade-actions">
      {wallet
        ? <button type="button" disabled={busy || chatting} className="button button-primary" onClick={() => void act("prepare")}>{busy ? stage : "Review & sign in wallet"}</button>
        : <button type="button" disabled={busy} className="button button-primary" onClick={() => connectWallet()}>Connect {shortAddress(r.wallet)}</button>}
      <button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("reject")}>Decline</button>
    </div>}
    {c.phase === "issued" && (c.hash
      ? <div className="hub-trade-actions"><button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("status")}>{busy ? "Checking…" : "Check onchain status"}</button></div>
      : <div className="hub-trade-recover">
        <p className="hub-notice">Check your wallet before doing anything else. If the transaction was sent, paste its hash so it can be verified. The reservation stays active until then.</p>
        {!c.batch && c.transaction?.nonce && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void act("resume")}>Retry same wallet request</button>}
        <div className="socialtrading-search"><input className="socialtrading-input mono" aria-label="Transaction hash" value={recovery} onChange={e => setRecovery(e.target.value)} placeholder="0x…" /><button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("recover")}>Verify</button></div>
      </div>)}
  </div>;
}
