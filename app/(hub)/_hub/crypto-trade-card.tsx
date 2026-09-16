"use client";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import type { TradeIntent } from "@/lib/socialtrading/types";
import { chain, explorerAddress, explorerTx, formatUnits, shortAddress } from "@/lib/crypto/chains";
import { timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";

export function cryptoStatus(trade: TradeIntent): string {
  const c = trade.crypto!;
  switch (trade.status) {
    case "blocked": return "Not allowed";
    case "approval_required": return "Waiting for your signature";
    case "reserved": return c.step === "approval" ? "Approved · sign the swap" : trade.initiator === "user" ? "Ready to sign" : "Within limits · sign to settle";
    case "unknown": return c.hash ? "Verifying onchain" : "Sent to your wallet";
    case "confirmed": return "Confirmed onchain";
    case "rejected": return "Declined";
    case "failed": return "Reverted onchain";
    default: return trade.status;
  }
}

export function CryptoTradeCard({ trade, expanded = false }: { trade: TradeIntent; expanded?: boolean }) {
  const { state, crypto, busy: chatting } = useHub(), { connectWallet } = usePrivy(), { wallets } = useWallets();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovery, setRecovery] = useState(""), [raw, setRaw] = useState(false);
  const lock = useRef(false), c = trade.crypto!, r = c.request, net = chain(r.chainId);
  const tokenIn = c.display?.tokenIn ?? { symbol: shortAddress(r.tokenIn), decimals: null }, tokenOut = c.display?.tokenOut ?? { symbol: shortAddress(r.tokenOut), decimals: null };
  const wallet = wallets.find(w => w.address.toLowerCase() === r.wallet);
  const storageKey = `rubicon:swap:${state.profile.userId}:${trade.id}:${c.step ?? "next"}`;
  const open = c.phase === "ready" && ["approval_required", "reserved"].includes(trade.status);

  async function act(action: "prepare" | "reject" | "status" | "recover") {
    if (lock.current) return; lock.current = true; setBusy(true); setError("");
    try {
      if (action === "prepare") {
        if (!wallet) throw new Error(`Connect the wallet ${shortAddress(r.wallet)} to sign this swap.`);
        await wallet.switchChain(r.chainId);
        const provider = await wallet.getEthereumProvider();
        const result = await crypto({ action: "prepare", tradeId: trade.id }), tx = result.transaction!;
        if (Date.now() >= result.expiresAt!) throw new Error("The quote expired before signing. Do not resend; check your wallet, then ask for a fresh proposal.");
        const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}`, chainId: `0x${tx.chainId.toString(16)}` }] });
        if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Your wallet returned no transaction hash. Check the wallet before retrying.");
        setRecovery(hash);
        try { localStorage.setItem(`rubicon:swap:${state.profile.userId}:${trade.id}:${result.step}`, hash); } catch { /* Recovery stays visible in this card. */ }
        await crypto({ action: "submitted", tradeId: trade.id, hash }); await crypto({ action: "status", tradeId: trade.id });
      } else if (action === "recover") {
        let hash = recovery.trim(); try { hash ||= localStorage.getItem(storageKey) ?? ""; } catch { /* no storage */ }
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Paste the 66-character transaction hash from your wallet.");
        await crypto({ action: "submitted", tradeId: trade.id, hash }); await crypto({ action: "status", tradeId: trade.id });
      } else await crypto({ action, tradeId: trade.id });
    } catch (e) { setError(e instanceof Error ? e.message : "Wallet request failed. Check your wallet before retrying."); }
    finally { lock.current = false; setBusy(false); }
  }

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
      <small>≈ {usd(trade.value, 2)} + gas</small>
    </p>
    {trade.reasoning && <p className="hub-trade-reasoning">{trade.reasoning}</p>}
    <p className="hub-trade-policy">{trade.policy.reason}</p>
    <p className="hub-trade-brokerage">{c.detail}</p>
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
        ? <button type="button" disabled={busy || chatting} className="button button-primary" onClick={() => void act("prepare")}>{busy ? "Opening wallet…" : c.step === "approval" ? "Sign the swap" : "Review & sign in wallet"}</button>
        : <button type="button" disabled={busy} className="button button-primary" onClick={() => connectWallet()}>Connect {shortAddress(r.wallet)}</button>}
      <button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("reject")}>Decline</button>
    </div>}
    {c.phase === "issued" && (c.hash
      ? <div className="hub-trade-actions"><button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("status")}>{busy ? "Checking…" : "Check onchain status"}</button></div>
      : <div className="hub-trade-recover">
        <p className="hub-notice">Check your wallet before doing anything else. If the transaction was sent, paste its hash so it can be verified. The reservation stays active until then.</p>
        <div className="socialtrading-search"><input className="socialtrading-input mono" aria-label="Transaction hash" value={recovery} onChange={e => setRecovery(e.target.value)} placeholder="0x…" /><button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("recover")}>Verify</button></div>
      </div>)}
  </div>;
}
