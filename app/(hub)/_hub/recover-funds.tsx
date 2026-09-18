"use client";

import { useWallets } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { CHAINS, explorerTx, parseUnits, shortAddress, type ChainId } from "@/lib/crypto/chains";
import { purchaseError } from "@/lib/crypto/readiness";
import type { Holding } from "@/lib/crypto/recovery";
import { useHub } from "./hub-provider";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const exactAmount = (holding: Holding) => {
  const digits = holding.balance.padStart(holding.decimals + 1, "0");
  if (!holding.decimals) return digits;
  const fraction = digits.slice(-holding.decimals).replace(/0+$/, "");
  return `${digits.slice(0, -holding.decimals)}${fraction ? `.${fraction}` : ""}`;
};

/** Sending something out of the app.
 *
 * Usually because it arrived by mistake — USDC on the wrong network is the
 * common one — so this is written as "here is what you have, where should it
 * go", not as a transfer form. Three things make it safe rather than scary: the
 * destination is only ever typed by the person, the confirmation names the
 * exact amount and network before anything is signed, and the transfer is
 * irreversible so it says so where the decision is made.
 *
 * Nothing here custodies anything. The server reads balances and prepares
 * calldata; the signature and the send are the user's own wallet. */
export function RecoverFunds() {
  const { crypto } = useHub();
  const { wallets } = useWallets();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Holding | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ hash: string; chainId: number } | null>(null);
  const lock = useRef(false);

  async function scan() {
    if (lock.current) return;
    lock.current = true; setLoading(true); setError(""); setSent(null);
    try {
      const result = await crypto({ action: "holdings" });
      setHoldings(result.holdings ?? []);
    } catch (e) { setError(purchaseError(e)); }
    finally { lock.current = false; setLoading(false); }
  }
  useEffect(() => { if (wallets.length && holdings === null && !loading) void scan();
    // Scans once when a wallet is available; refreshing is an explicit choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallets.length]);

  function choose(holding: Holding) {
    setPicked(holding); setTo(""); setAmount(exactAmount(holding)); setConfirming(false); setError(""); setSent(null);
  }

  const wallet = picked ? wallets.find(w => w.address.toLowerCase() === picked.wallet.toLowerCase()) : undefined;
  const validAddress = ADDRESS.test(to.trim()) && !/^0x0{40}$/i.test(to.trim());
  const base = (() => {
    if (!picked || !amount.trim()) return null;
    try { const v = parseUnits(amount, picked.decimals); return BigInt(v) > BigInt(picked.balance) ? null : v; } catch { return null; }
  })();
  const ready = !!picked && validAddress && !!base && !!wallet;

  async function send() {
    if (!ready || lock.current || !picked || !base) return;
    lock.current = true; setSending(true); setError("");
    try {
      const prepared = await crypto({ action: "withdraw", chainId: picked.chainId, wallet: picked.wallet, token: picked.token, to: to.trim(), amount: base });
      const tx = prepared.transaction;
      if (!tx) throw new Error("Nothing was prepared. Try again.");
      await wallet!.switchChain(picked.chainId);
      const provider = await wallet!.getEthereumProvider();
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!Array.isArray(accounts) || !accounts.some(a => String(a).toLowerCase() === picked.wallet.toLowerCase())) throw new Error("Reconnect the selected wallet before continuing.");
      if (Number(await provider.request({ method: "eth_chainId" })) !== picked.chainId) throw new Error(`Switch to ${picked.chainName} in your wallet, then try again.`);
      const hash = await provider.request({ method: "eth_sendTransaction", params: [{ from: tx.from, to: tx.to, data: tx.data, value: "0x0", nonce: tx.nonce }] });
      if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Your wallet did not return a transaction. Check it before trying again.");
      setSent({ hash, chainId: picked.chainId });
      setPicked(null); setConfirming(false); setHoldings(null);
    } catch (e) { setError(purchaseError(e)); }
    finally { lock.current = false; setSending(false); }
  }

  if (!wallets.length) return <p className="socialtrading-caption">Connect a wallet to see what you’re holding.</p>;

  return <div className="hub-recover">
    {sent && <p className="hub-recover-sent" role="status">
      <Check size={14} aria-hidden="true" />
      <span>Sent. <a className="hub-inline-link mono" href={explorerTx(sent.chainId, sent.hash)} target="_blank" rel="noopener noreferrer">{shortAddress(sent.hash)}<ArrowUpRight size={11} aria-hidden="true" /></a> It can take a minute to appear.</span>
    </p>}

    {loading && holdings === null && <p className="hub-empty-inline" role="status">Looking across your networks…</p>}
    {error && !picked && <p className="hub-error" role="alert">{error}</p>}

    {holdings !== null && !holdings.length && !loading && <p className="socialtrading-caption">Nothing is sitting in your wallets across {Object.keys(CHAINS).length} networks. If something arrived that you can’t see here, <button type="button" className="hub-inline-link" onClick={() => void scan()}>check again</button>.</p>}

    {holdings !== null && holdings.length > 0 && <>
      <ul className="hub-recover-list" aria-label="What you're holding">
        {holdings.map(h => <li key={`${h.chainId}:${h.token}:${h.wallet}`}>
          <button type="button" className="hub-recover-row" aria-pressed={picked?.token === h.token && picked?.chainId === h.chainId} onClick={() => choose(h)}>
            <span className="hub-recover-amount">{h.display} {h.symbol}</span>
            <span className="hub-recover-where">on {h.chainName}</span>
            <span className="hub-recover-go">Send out</span>
          </button>
        </li>)}
      </ul>
      <button type="button" className="hub-chip-button" disabled={loading} onClick={() => void scan()}>{loading ? "Checking…" : "Check again"}</button>
    </>}

    {picked && <div className="hub-recover-form">
      <p className="hub-recover-title">Send {picked.display} {picked.symbol} out of {picked.chainName}</p>
      <label className="hub-recover-field">
        <span>How much</span>
        <input className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, "")); setConfirming(false); }} />
        <button type="button" className="hub-chip-button" onClick={() => { setAmount(exactAmount(picked)); setConfirming(false); }}>All of it</button>
      </label>
      <label className="hub-recover-field">
        <span>Where to</span>
        <input className="socialtrading-input mono" placeholder="0x…" autoComplete="off" spellCheck={false} value={to} onChange={e => { setTo(e.target.value.trim()); setConfirming(false); }} />
      </label>
      {to && !validAddress && <p className="hub-notice">That doesn’t look like a wallet address. It should start with 0x and be 42 characters.</p>}
      {amount.trim() && !base && <p className="hub-notice">Enter an amount you actually hold — up to {picked.display} {picked.symbol}.</p>}
      {!wallet && <p className="hub-notice">Connect {shortAddress(picked.wallet)} to send this.</p>}
      <p className="socialtrading-caption">Withdrawals stay on {picked.chainName}. Keep some {CHAINS[picked.chainId as ChainId].nativeSymbol} in this wallet on {picked.chainName} for the network fee; unlike buys, withdrawals do not pay gas with USDC.</p>
      {error && <p className="hub-error" role="alert">{error}</p>}

      {/* The last honest moment before it is gone. Named in full, because a
        * transfer to a wrong address cannot be undone by anyone. */}
      {confirming
        ? <div className="hub-recover-confirm">
            <p><strong>Send {amount} {picked.symbol} on {picked.chainName}</strong> to <span className="mono">{shortAddress(to)}</span>?</p>
            <p>This cannot be undone. Check the address is right and that it accepts {picked.symbol} on {picked.chainName}.</p>
            <div className="hub-recover-actions">
              <button type="button" className="button button-primary" disabled={!ready || sending} onClick={() => void send()}>{sending ? "Check your wallet…" : "Yes, send it"}</button>
              <button type="button" className="hub-chip-button" disabled={sending} onClick={() => setConfirming(false)}>Back</button>
            </div>
          </div>
        : <div className="hub-recover-actions">
            <button type="button" className="button button-primary" disabled={!ready} onClick={() => setConfirming(true)}>Review this transfer</button>
            <button type="button" className="hub-chip-button" onClick={() => { setPicked(null); setError(""); }}>Cancel</button>
          </div>}
    </div>}
  </div>;
}
