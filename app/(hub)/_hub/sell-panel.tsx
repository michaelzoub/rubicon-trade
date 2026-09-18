"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import { chain, parseUnits } from "@/lib/crypto/chains";
import { BUY_CHAIN } from "@/lib/crypto/tradable";
import { catalogEntry } from "@/lib/crypto/catalog";
import type { Holding } from "@/lib/crypto/recovery";
import { purchaseError } from "@/lib/crypto/readiness";
import { useHub } from "./hub-provider";
import { AssetLogo, TradeCard } from "./parts";

const key = (h: Holding) => `${h.chainId}:${h.wallet}:${h.token}`;
export function SellPanel({ initialSymbol, initialHolding, onDone }: { initialSymbol?: string; initialHolding?: Pick<Holding, "chainId" | "wallet" | "token">; onDone?: () => void }) {
  const { crypto, state } = useHub();
  const [holdings, setHoldings] = useState<Holding[] | null>(null);
  const [partial, setPartial] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError("");
    try {
      const result = await crypto({ action: "holdings" });
      if (current !== generation.current) return;
      setHoldings((result.holdings ?? []).filter(h => h.chainId === BUY_CHAIN)); setPartial(result.complete === false);
    } catch (e) { if (current === generation.current) setError(purchaseError(e)); }
    finally { if (current === generation.current) setLoading(false); }
  }, [crypto]);
  const settlements = state.trades.filter(t => t.status === "confirmed").map(t => t.id).join(":");
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load, settlements]);
  useEffect(() => {
    if (!initialHolding || !holdings) return;
    const match = holdings.find(h => h.chainId === initialHolding.chainId && h.wallet.toLowerCase() === initialHolding.wallet.toLowerCase() && h.token.toLowerCase() === initialHolding.token.toLowerCase());
    if (match && match.kind !== 'usdc') setSelected(key(match));
  }, [holdings, initialHolding]);
  const held = holdings?.find(h => key(h) === selected);
  const trade = state.trades.find(t => t.id === tradeId);
  let valid = false;
  // Both buys and sales are restricted to Base.
  try { valid = !!held && held.chainId === BUY_CHAIN && BigInt(parseUnits(amount, held.decimals)) <= BigInt(held.balance); } catch { /* Wait for a valid amount. */ }
  async function sell(e: FormEvent) {
    e.preventDefault();
    if (!valid || !held || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await crypto({ action: "propose", chainId: held.chainId, wallet: held.wallet, tokenIn: held.token, tokenOut: chain(held.chainId).usdc, amount, slippageBps: 50, note: `Sell ${amount} ${held.symbol} for USDC` });
      if (!result.tradeId) throw new Error("No sale quote was returned. Try again.");
      setTradeId(result.tradeId);
    } catch (e) { setError(purchaseError(e)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="hub-buy hub-sell" aria-label="Sell your tokens">
    <div className="hub-trade-head"><p className="hub-part-title">{held ? `Sell ${held.symbol}` : "What you own"}</p>{!tradeId && <button type="button" className="hub-chip-button" disabled={loading} onClick={() => void load()}>{loading ? "Checking…" : "Refresh"}</button>}</div>
    {!tradeId && <>
      <p className="purchase-requirements">Choose what to let go of. Your sale returns USDC to your wallet.</p>
      {partial && <p className="purchase-requirements" role="status">Some tokens may be missing. Refresh to check again.</p>}
      {loading && holdings === null && <p role="status" className="hub-empty-inline">Finding what’s yours…</p>}
      {holdings && !holdings.length && <p className="hub-empty-inline">No tokens found yet.</p>}
      <ul className="hub-buy-results" aria-label="Your wallet tokens">{holdings?.map((h, i) => <li key={key(h)}>
        <button type="button" className="hub-buy-result" aria-pressed={selected === key(h)} disabled={h.kind === "usdc"} onClick={() => { setSelected(key(h)); setAmount(""); setError(""); }}>
          <AssetLogo asset={{ symbol: h.symbol, logo: catalogEntry(h.chainId, h.token)?.icon }} />
          <span className="hub-buy-result-id"><strong>{h.symbol}</strong><span>{h.chainName}{holdings.filter(o => o.token === h.token && o.chainId === h.chainId).length > 1 ? ` · Wallet ${i + 1}` : ""}</span></span>
          <span className="hub-sell-balance">{h.display}<small>{h.kind === "usdc" ? "Available funds" : initialSymbol?.toUpperCase() === h.symbol.toUpperCase() ? "Your selected asset" : ""}</small></span>
        </button>
      </li>)}</ul>
      {held && <form className="hub-buy-form" onSubmit={sell}>
        <div className="hub-buy-amount"><label htmlFor="sell-amount">Amount to sell</label><div className="hub-buy-amount-row"><input id="sell-amount" className="socialtrading-input" inputMode="decimal" autoComplete="off" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" /><span className="hub-buy-unit" title={held.symbol}>{held.symbol}</span></div></div>
        <div className="hub-buy-presets" role="group" aria-label="Amount of your holding to sell">{[25, 50, 100].map(percent => <button type="button" className="hub-chip-button" key={percent} onClick={() => setAmount(formatUnits(BigInt(held.balance) * BigInt(percent) / 100n, held.decimals))}>{percent === 100 ? "Max" : `${percent}%`}</button>)}</div>
        <p className="purchase-requirements">Keep a little USDC in your wallet for the network fee.</p>
        <button type="submit" className="button button-primary" disabled={!valid || busy}>{busy ? "Getting your sale quote…" : "Review sale"}</button>
      </form>}
    </>}
    {error && <p className="hub-error" role="alert">{error}</p>}
    {tradeId && <TradeCard tradeId={tradeId} simple />}
    {trade && ["confirmed", "rejected", "failed", "blocked"].includes(trade.status) && <button type="button" className="hub-chip-button" onClick={() => { setTradeId(null); setSelected(""); setAmount(""); void load(); }}>Back to what you own</button>}
    {trade?.status === "confirmed" && onDone && <button type="button" className="button button-primary" onClick={onDone}>Return to your world</button>}
  </section>;
}
