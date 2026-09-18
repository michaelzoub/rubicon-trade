"use client";
import { usePrivy, useSign7702Authorization, useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TradeIntent } from "@/lib/socialtrading/types";
import { chain, explorerAddress, explorerTx, formatUnits, gaslessChain, shortAddress } from "@/lib/crypto/chains";
import { recoverSwapOperation, type SignAuthorization } from "@/lib/crypto/gasless";
import { purchaseError } from "@/lib/crypto/readiness";
import { executePurchase, type PurchaseStage } from "./execute-purchase";
import { AgentMark } from "./agent-mark";
import { timeAgo, usd } from "./format";
import { useHub } from "./hub-provider";

/** An amount, or an admission that we cannot state one.
 *
 * `formatUnits` with null decimals hands back the raw base-unit integer, which
 * on a confirmation reads as a quantity: 227373 where the buyer is getting
 * 0.00227373. Nothing about that looks like an error, so it has to be caught
 * here rather than trusted to look wrong. The decimals are resolved for real
 * before any calldata is signed. */
function quantity(base: string, token: { symbol: string; decimals: number | null }) {
  return token.decimals === null ? `${token.symbol} · amount confirmed when you continue` : `${formatUnits(base, token.decimals)} ${token.symbol}`;
}

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

/** The same steps, said the way a record says them. */
function sentence(step: PurchaseStage): string {
  switch (step.kind) {
    case "switching": return `Switching wallet to ${step.network}`;
    case "checking": return "Checking wallet and funds";
    case "quoting": return "Checking approvals and refreshing quote";
    case "permit": return "Sign Permit2 authorization";
    case "authorizing": return "Creating and simulating swap";
    case "signing": return "Sign purchase · network fee paid in USDC";
    case "submitted": return "Submitted · awaiting confirmation";
    case "broadcast": return "Broadcast · awaiting confirmation";
  }
}

export function CryptoTradeCard({ trade, expanded = false, simple = false, quiet = false }: { trade: TradeIntent; expanded?: boolean; simple?: boolean;
  /** Rendered under something that already shows the asset and the amount, so
   * the card says only what is not already on the screen. */
  quiet?: boolean }) {
  const { state, crypto, busy: chatting } = useHub(), { connectWallet } = usePrivy(), { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  const [stage, setStage] = useState("");
  const [funds, setFunds] = useState("");
  const [operation, setOperation] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [recovery, setRecovery] = useState(""), [raw, setRaw] = useState(false);
  const lock = useRef(false), c = trade.crypto!, r = c.request, net = chain(r.chainId);
  const tokenIn = c.display?.tokenIn ?? { symbol: shortAddress(r.tokenIn), decimals: null }, tokenOut = c.display?.tokenOut ?? { symbol: shortAddress(r.tokenOut), decimals: null };
  const wallet = wallets.find(w => w.address.toLowerCase() === r.wallet.toLowerCase());
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
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
        await executePurchase(trade, action, {
          crypto, signAuthorization: signAuthorization as SignAuthorization,
          wallets: () => walletsRef.current,
          onStage: step => setStage(sentence(step)),
          onFunds: setFunds,
          onSubmitted: (op, step) => { setOperation(op); try { localStorage.setItem(`rubicon:swap:${state.profile.userId}:${trade.id}:${step}:operation`, op); } catch { /* reference stays on screen */ } },
          onHash: (hash, step) => { setRecovery(hash); try { localStorage.setItem(`rubicon:swap:${state.profile.userId}:${trade.id}:${step}`, hash); } catch { /* Hash remains visible. */ } },
        });
      } else if (action === "operation") {
        const hash = await recoverSwapOperation(r.chainId, operation);
        if (!hash) { setError("Still waiting for network confirmation. Check again shortly; do not submit another purchase."); return; }
        setRecovery(hash);
        await crypto({ action: "submitted", tradeId: trade.id, hash, userOpHash: operation });
        await crypto({ action: "status", tradeId: trade.id });
      } else if (action === "recover") {
        let hash = (simple ? recovery || recoveryInput : recovery).trim(); try { hash ||= localStorage.getItem(storageKey) ?? ""; } catch { /* no storage */ }
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

  // Recover the saved submission quietly; never ask the buyer to track an operation ID.
  useEffect(() => {
    if (!simple || !operation || c.hash || recovery || trade.status === "confirmed") return;
    const timer = setInterval(() => { if (!lock.current) void act("operation"); }, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simple, operation, c.hash, recovery, trade.id, trade.status]);

  if (simple) {
    const selling = trade.side === "sell";
    const noun = selling ? "sale" : "purchase";
    const submitted = !!(operation || recovery || c.hash);
    const waiting = busy || (!open && !["confirmed", "failed", "rejected", "blocked"].includes(trade.status));
    const title = trade.status === "confirmed" ? selling ? "Sold." : "It’s yours."
      : trade.status === "failed" ? `${selling ? "Sale" : "Purchase"} didn’t go through`
      : trade.status === "rejected" ? `${selling ? "Sale" : "Purchase"} declined`
      : trade.status === "blocked" ? `${selling ? "Sale" : "Purchase"} unavailable`
      : submitted ? selling ? "Settling your sale" : "Making it yours" : busy ? "Working on it" : quiet ? "Ready when you are" : "One last step";
    const message = trade.status === "confirmed" ? selling ? "USDC is now in your wallet." : "Your portfolio has been updated."
      : trade.status === "blocked" ? trade.policy.reason
      : ["failed", "rejected"].includes(trade.status) ? "You can start again when you’re ready."
      : submitted ? `We’ll confirm your ${noun} here. You can safely close this window.`
      : busy ? "Follow the prompts in your wallet. We’ll handle the rest."
      // Under the panel this sits beside whatever went wrong, and "confirm in
      // your wallet" would be answering a question nobody asked.
      : quiet ? "Nothing has been charged."
      : "Confirm in your wallet. We’ll handle the rest.";
    return <div className={`hub-trade hub-trade--crypto hub-purchase-simple is-${trade.status}`} role="group" aria-label={selling ? "Sale confirmation" : "Purchase confirmation"}>
      <div className="purchase-progress" role="status" aria-live="polite">
        <span className={`purchase-progress-light${waiting ? " is-active" : ""}`}><AgentMark expression={trade.status === "confirmed" ? "interacting" : waiting ? "thinking" : "observing"} /></span>
        <strong>{title}</strong><p>{message}</p>
      </div>
      {!quiet && <p className="hub-trade-line">
        <span className="hub-trade-line-out"><span className="purchase-quantity-label">You pay</span>{quantity(r.amount, tokenIn)}</span>
        <span className="hub-trade-line-in"><span className="purchase-quantity-label">{trade.status === "confirmed" ? "You received" : "You receive"}</span>{quantity(c.outputAmount, tokenOut)}</span>
        {open && <small>You receive at least {quantity(c.minimumOutput, tokenOut)}</small>}
        <small>Network fee paid in {gaslessChain(r.chainId) ? "USDC" : net.nativeSymbol}</small>
      </p>}
      {error && <p className="hub-error" role="alert">{error}</p>}
      {open && !submitted && <div className="hub-trade-actions">
        <button type="button" disabled={busy || chatting} className="button button-primary" onClick={() => wallet ? void act("prepare") : connectWallet()}>{busy ? "Waiting for your wallet" : wallet ? quiet ? "Try again" : selling ? "Confirm sale" : "Confirm purchase" : "Connect wallet"}</button>
      </div>}
      {submitted && trade.status !== "confirmed" && <div className="hub-trade-actions">
        <button type="button" className="button button-secondary" disabled={busy} onClick={() => void act(c.hash ? "status" : recovery ? "recover" : "operation")}>{busy ? "Checking" : selling ? "Check sale" : "Check purchase"}</button>
      </div>}
      {!submitted && c.phase === "issued" && <div className="hub-trade-recover">
        <p className="hub-notice">Check your wallet to see whether your {noun} was sent.</p>
        {!c.batch && c.transaction?.nonce && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void act("resume")}>Continue in wallet</button>}
        <details className="hub-disclosure"><summary>Recover a sent {noun}</summary><div className="socialtrading-search"><input className="socialtrading-input" aria-label="Transaction hash" value={recoveryInput} onChange={e => setRecoveryInput(e.target.value)} placeholder="Paste your wallet’s transaction reference" /><button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("recover")}>Find {noun}</button></div></details>
      </div>}
    </div>;
  }

  return <div className={`hub-trade hub-trade--crypto is-${trade.status}${open ? " hub-priority-card" : ""}`} role="group" aria-label="Onchain swap">
    <div className="hub-trade-head">
      <p className="hub-part-title">Swap · Uniswap on {net.name}</p>
      {!(open && trade.initiator === "user") && <span className="hub-trade-status">{cryptoStatus(trade)}</span>}
    </div>
    {trade.initiator !== "user" && <p className="hub-trade-byline">Proposed by {state.agent?.name ?? "your agent"} · {timeAgo(trade.createdAt)}</p>}
    {/* The trade in one line. Wallet, slippage and the exact minimum are real
      * but secondary, so they wait behind Details rather than competing with
      * the only question the card actually asks: do you want this? */}
    <p className="hub-trade-line">
      <span className="hub-trade-line-out"><span className="purchase-quantity-label">You pay</span>{quantity(r.amount, tokenIn)}</span>
      <span className="hub-trade-line-arrow" aria-hidden="true">→</span>
      <span className="hub-trade-line-in"><span className="purchase-quantity-label">You receive</span>{quantity(c.outputAmount, tokenOut)}</span>
      <small>≈ {usd(trade.value, 2)} · network fee paid in {gaslessChain(r.chainId) ? "USDC" : net.nativeSymbol}</small>
    </p>
    {/* One guarantee before signing: the worst case you have agreed to. Wallet,
      * network and slippage repeat inside Details, so printing them here as
      * well only buries the number that actually protects the buyer. */}
    {operation && <p className="purchase-requirements">Submitted operation: <span className="mono">{operation}</span>. Keep this reference if confirmation takes longer. <button type="button" className="hub-chip-button" disabled={busy} onClick={() => void act("operation")}>Check submitted purchase</button></p>}
    {/* A trade the person placed already says what it is in the line above, and
      * the agent's limits are not a fact about it. Both are worth reading when
      * the agent proposed it, or when policy is the reason it cannot proceed. */}
    {trade.initiator !== "user" && trade.reasoning && <p className="hub-trade-reasoning">{trade.reasoning}</p>}
    {(trade.initiator !== "user" || !trade.policy.allowed) && <p className="hub-trade-policy">{trade.policy.reason}</p>}
    {/* While a step is running its progress is the status; the resting copy is
      * only worth the space once there is nothing more useful to say. */}
    {!busy && !open && c.detail && <p className="hub-trade-brokerage">{c.detail}</p>}
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
        {funds && <p className="socialtrading-caption">{funds}</p>}
        <button type="button" className="hub-trade-raw-toggle" aria-expanded={raw} onClick={() => setRaw(v => !v)}><ChevronDown size={12} aria-hidden="true" />{raw ? "Hide" : "Show"} contract addresses</button>
        {raw && <dl className="hub-trade-raw mono">
          <div><dt>Pay token</dt><dd><a href={explorerAddress(r.chainId, r.tokenIn)} target="_blank" rel="noopener noreferrer">{r.tokenIn}</a></dd></div>
          <div><dt>Receive token</dt><dd><a href={explorerAddress(r.chainId, r.tokenOut)} target="_blank" rel="noopener noreferrer">{r.tokenOut}</a></dd></div>
          <div><dt>Base units</dt><dd>{r.amount} → ≥ {c.minimumOutput}</dd></div>
        </dl>}
        {open && trade.initiator === "user" && <button type="button" disabled={busy} className="hub-chip-button" onClick={() => void act("reject")}>Decline</button>}
      </div>
    </details>
    {error && <p className="hub-error" role="alert">{error}</p>}
    {open && <div className="hub-trade-actions">
      {wallet
        ? <button type="button" disabled={busy || chatting} className="button button-primary" onClick={() => void act("prepare")}>{busy ? stage : "Review & sign in wallet"}</button>
        : <button type="button" disabled={busy} className="button button-primary" onClick={() => connectWallet()}>Connect {shortAddress(r.wallet)}</button>}
      {trade.initiator !== "user" && <button type="button" disabled={busy} className="button button-secondary" onClick={() => void act("reject")}>Decline</button>}
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
