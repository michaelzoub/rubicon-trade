"use client";

import { HubLink } from "./navigation";
import { useWallets } from "@privy-io/react-auth";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CHAIN_IDS, CHAINS, DEFAULT_CHAIN, NATIVE, shortAddress, type ChainId } from "@/lib/crypto/chains";
import { useHub } from "./hub-provider";
import { TradeCard } from "./parts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SLIPPAGE = [{ bps: 10, label: "0.1%" }, { bps: 50, label: "0.5%" }, { bps: 100, label: "1%" }];

/** The user's own swap. It goes through the same server path as agent
 * proposals (quote, valuation, policy, reservation) with `initiator: user`, so
 * the agent's mode never blocks it and it never consumes the agent's allowance.
 * Nothing moves until the user signs in their wallet. */
export function SwapForm({ receive, contracts, title = "Trade onchain", onProposed }: {
  /** Prefill the receive side, e.g. from an asset detail page. */
  receive?: { symbol: string; contracts?: Record<string, string> };
  contracts?: Record<string, string>;
  title?: string;
  onProposed?: (tradeId: string) => void;
}) {
  const { crypto, state } = useHub();
  const { wallets, ready } = useWallets();
  const known = receive?.contracts ?? contracts;
  const chains = useMemo(() => known ? CHAIN_IDS.filter(id => known[String(id)]) : CHAIN_IDS, [known]);
  const [chainId, setChainId] = useState<ChainId>(chains.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : chains[0] ?? DEFAULT_CHAIN);
  const [wallet, setWallet] = useState("");
  const [pay, setPay] = useState<"usdc" | "native" | "other">("usdc");
  const [payOther, setPayOther] = useState("");
  const [tokenOut, setTokenOut] = useState(known?.[String(chainId)] ?? "");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippage] = useState(50);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);
  const net = CHAINS[chainId];
  useEffect(() => { if (!wallet && wallets[0]) setWallet(wallets[0].address.toLowerCase()); }, [wallets, wallet]);
  useEffect(() => { if (known?.[String(chainId)]) setTokenOut(known[String(chainId)]); }, [known, chainId]);
  const tokenIn = pay === "usdc" ? net.usdc : pay === "native" ? NATIVE : payOther.trim();
  const payLabel = pay === "usdc" ? "USDC" : pay === "native" ? net.nativeSymbol : "tokens";
  const valid = ADDRESS.test(tokenIn) && ADDRESS.test(tokenOut) && /^\d*\.?\d+$/.test(amount.replace(/,/g, "")) && Number(amount.replace(/,/g, "")) > 0 && ADDRESS.test(wallet) && tokenIn.toLowerCase() !== tokenOut.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true); setError(""); setTradeId(null);
    try {
      const result = await crypto({ action: "propose", chainId, wallet, tokenIn, tokenOut, amount: amount.replace(/,/g, ""), slippageBps, note: note.trim() || undefined });
      if (result.tradeId) { setTradeId(result.tradeId); onProposed?.(result.tradeId); setAmount(""); setNote(""); }
    } catch (err) { setError(err instanceof Error ? err.message : "The swap could not be set up."); }
    finally { setBusy(false); }
  }

  return <section className="hub-swap" aria-labelledby="swap-title">
    <div className="hub-trade-head"><p id="swap-title" className="hub-part-title">{title}</p><span className="hub-trade-status">Uniswap · you sign</span></div>
    <p className="hub-section-lead">Swap from a wallet you control. This is your decision: your agent’s mode and spending limits apply only to trades it proposes. You review the exact quote, then sign in your wallet.</p>
    {ready && wallets.length === 0 && <p className="hub-notice">Connect or create a wallet first. Manage wallets on the <HubLink className="hub-inline-link" href="/profile">Profile</HubLink> page.</p>}
    <form className="hub-swap-form" onSubmit={submit}>
      <label className="hub-swap-field">Network
        <select className="socialtrading-input" value={chainId} onChange={e => setChainId(Number(e.target.value) as ChainId)}>{chains.map(id => <option key={id} value={id}>{CHAINS[id].name}</option>)}</select>
      </label>
      <label className="hub-swap-field">From wallet
        <select className="socialtrading-input mono" value={wallet} onChange={e => setWallet(e.target.value)} disabled={!wallets.length}>
          {!wallets.length && <option value="">No connected wallet</option>}
          {wallets.map(w => <option key={w.address} value={w.address.toLowerCase()}>{shortAddress(w.address)} · {w.walletClientType === "privy" ? "embedded" : w.walletClientType}</option>)}
        </select>
      </label>
      <label className="hub-swap-field">Pay with
        <select className="socialtrading-input" value={pay} onChange={e => setPay(e.target.value as typeof pay)}>
          <option value="usdc">USDC</option><option value="native">{net.nativeSymbol} (native)</option><option value="other">Another token…</option>
        </select>
      </label>
      {pay === "other" && <label className="hub-swap-field">Pay token contract<input className="socialtrading-input mono" value={payOther} onChange={e => setPayOther(e.target.value)} placeholder="0x…" spellCheck={false} /></label>}
      <label className="hub-swap-field">Amount to spend
        <span className="hub-swap-amount"><input className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="25" aria-label={`Amount in ${payLabel}`} /><span>{payLabel}</span></span>
      </label>
      <label className="hub-swap-field hub-swap-field--wide">Receive token contract{receive?.symbol ? ` · ${receive.symbol}` : ""}
        <input className="socialtrading-input mono" value={tokenOut} onChange={e => setTokenOut(e.target.value)} placeholder={`0x… on ${net.name}`} spellCheck={false} />
      </label>
      <label className="hub-swap-field">Max slippage
        <select className="socialtrading-input" value={slippageBps} onChange={e => setSlippage(Number(e.target.value))}>{SLIPPAGE.map(s => <option key={s.bps} value={s.bps}>{s.label}</option>)}</select>
      </label>
      <label className="hub-swap-field hub-swap-field--wide">Note to self (optional)<input className="socialtrading-input" value={note} maxLength={600} onChange={e => setNote(e.target.value)} placeholder="Why you’re making this trade" /></label>
      {error && <p className="hub-error hub-swap-field--wide" role="alert">{error}</p>}
      <div className="hub-trade-actions hub-swap-field--wide">
        <button type="submit" className="button button-primary" disabled={!valid || busy}>{busy ? "Getting a quote…" : "Get quote"}</button>
        <span className="socialtrading-caption">Quotes are exact-input on Uniswap V2/V3. Symbols are never trusted: contracts are.</span>
      </div>
    </form>
    {tradeId && state.trades.some(t => t.id === tradeId) && <div className="hub-swap-result"><TradeCard tradeId={tradeId} /></div>}
  </section>;
}
