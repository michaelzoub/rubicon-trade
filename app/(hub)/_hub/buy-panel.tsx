"use client";

import { useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CHAINS, DEFAULT_CHAIN, explorerAddress, shortAddress, type ChainId } from "@/lib/crypto/chains";
import type { TokenMatch } from "@/lib/crypto/search";
import { compact, pct, usd } from "./format";
import { useHub } from "./hub-provider";
import { TradeCard } from "./parts";

const PRESETS = ["25", "50", "100", "250"];
const USD = /^\d{1,7}(\.\d{1,2})?$/;

/** A literal buy: pick a token or tokenized stock, say how many dollars, sign in
 * your wallet. Pays with USDC on the token's chain through Uniswap. Same server
 * path as agent proposals, with `initiator: user`, so agent mode never blocks it. */
export function BuyPanel({ preselected, title = "Buy" }: {
  /** Skip the search: buy this asset, e.g. from its detail page. */
  preselected?: { symbol: string; name: string; contracts: Record<string, string> };
  title?: string;
}) {
  const { crypto, searchTokens, state } = useHub();
  const { wallets, ready } = useWallets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TokenMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<TokenMatch | null>(null);
  const [chainId, setChainId] = useState<ChainId>(DEFAULT_CHAIN);
  const [wallet, setWallet] = useState("");
  const [amount, setAmount] = useState("50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);

  const presetChains = useMemo(() => preselected ? (Object.keys(preselected.contracts).map(Number).filter(id => id in CHAINS) as ChainId[]) : [], [preselected]);
  useEffect(() => { if (presetChains.length && !presetChains.includes(chainId)) setChainId(presetChains.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : presetChains[0]); }, [presetChains, chainId]);
  useEffect(() => { if (!wallet && wallets[0]) setWallet(wallets[0].address.toLowerCase()); }, [wallets, wallet]);
  useEffect(() => {
    if (preselected) return;
    let live = true;
    const q = query.trim();
    setError(""); setSearching(true); setResults(null);
    const handle = setTimeout(async () => {
      try {
        const list = q.length >= 2 ? await searchTokens(q) : q ? [] : await (async () => {
          const batches = await Promise.allSettled(["WETH", "cbBTC", "bNVDA"].map(term => searchTokens(term)));
          if (batches.every(b => b.status === "rejected")) throw new Error("Suggestions are unavailable. Try searching for an asset.");
          return batches.flatMap(b => b.status === "fulfilled" ? b.value.filter(t => !t.thin).slice(0, 2) : []);
        })();
        if (live) setResults([...new Map(list.map(t => [`${t.chainId}:${t.address}`, t])).values()]);
      } catch (e) { if (live) { setResults([]); setError(e instanceof Error ? e.message : "Search failed."); } }
      finally { if (live) setSearching(false); }
    }, q ? 300 : 0);
    return () => { live = false; clearTimeout(handle); };
  }, [query, searchTokens, preselected]);

  const target = preselected ? { symbol: preselected.symbol, name: preselected.name, chainId, address: preselected.contracts[String(chainId)] } : picked ? { symbol: picked.symbol, name: picked.name, chainId: picked.chainId, address: picked.address } : null;
  const net = target ? CHAINS[target.chainId] : null;
  const valid = !!target && !!net && USD.test(amount) && Number(amount) > 0 && /^0x[0-9a-fA-F]{40}$/.test(wallet);

  async function buy(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || !target || !net) return;
    setBusy(true); setError(""); setTradeId(null);
    try {
      const result = await crypto({ action: "propose", chainId: target.chainId, wallet, tokenIn: net.usdc, tokenOut: target.address, amount, slippageBps: 50, note: `Buy ${usd(Number(amount), 2)} of ${target.symbol.toUpperCase()}` });
      if (result.tradeId) setTradeId(result.tradeId);
    } catch (err) { setError(err instanceof Error ? err.message : "The buy could not be set up."); }
    finally { setBusy(false); }
  }

  return <section className="hub-buy" aria-labelledby="buy-title">
    <div className="hub-trade-head"><p id="buy-title" className="hub-part-title">{title}</p><span className="hub-trade-status">Pay with USDC</span></div>
    {!preselected && <div className="hub-buy-search">
      <label className="sr-only" htmlFor="buy-search">Search a token or tokenized stock</label>
      <div className="hub-buy-search-box"><Search size={14} aria-hidden="true" /><input id="buy-search" className="socialtrading-input" value={query} onChange={e => { setQuery(e.target.value); setPicked(null); setTradeId(null); }} placeholder="Search coins or tokenized stocks" autoComplete="off" spellCheck={false} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(null); }}><X size={13} /></button>}</div>
      {!picked && !query && <p className="hub-part-title hub-buy-suggestions-title">Available to buy</p>}
      {!picked && searching && <p className="hub-empty-inline" role="status">Finding assets…</p>}
      {!picked && error && <p className="hub-error" role="alert">{error}</p>}
      {!picked && results !== null && <ul className="hub-buy-results" role="listbox" aria-label="Matching tokens">
        {searching && <li className="hub-empty-inline">Searching…</li>}
        {!searching && results.length === 0 && <li className="hub-empty-inline">No assets found. Try another name or symbol.</li>}
        {results.map(t => <li key={`${t.chainId}:${t.address}`}>
          <button type="button" role="option" aria-selected={false} className="hub-buy-result" onClick={() => { setPicked(t); setError(""); }}>
            <span className="hub-buy-result-id"><strong>{t.symbol.toUpperCase()}</strong><span>{t.name}</span></span>
            <span className="hub-buy-result-tags">{t.kind === "stock" && <span className="hub-label hub-label--emerging">Tokenized stock</span>}<span className="hub-label hub-label--related">{t.chain}</span>{t.thin && <span className="hub-label hub-label--muted">thin liquidity</span>}</span>
            <span className="hub-buy-result-price"><span>{usd(t.priceUsd)}</span><span className={`hub-change${(t.change24h ?? 0) > 0 ? " is-up" : (t.change24h ?? 0) < 0 ? " is-down" : ""}`}>{pct(t.change24h)}</span><small>liq. ${compact(t.liquidityUsd)}</small></span>
          </button>
        </li>)}
      </ul>}
    </div>}
    {target && net && <form className="hub-buy-form" onSubmit={buy}>
      <div className="hub-buy-target">
        <div><p className="hub-buy-target-symbol">{target.symbol.toUpperCase()} <span>· {target.name}</span></p><p className="hub-buy-target-meta">on {net.name} · contract <a className="mono hub-inline-link" href={explorerAddress(target.chainId, target.address)} target="_blank" rel="noopener noreferrer">{shortAddress(target.address)}<ArrowUpRight size={11} aria-hidden="true" /></a>{picked?.thin ? " · thin liquidity, expect slippage" : ""}</p></div>
        {!preselected && <button type="button" className="hub-chip-button" onClick={() => setPicked(null)}>Change</button>}
        {preselected && presetChains.length > 1 && <select className="socialtrading-input hub-buy-chain" aria-label="Network" value={chainId} onChange={e => setChainId(Number(e.target.value) as ChainId)}>{presetChains.map(id => <option key={id} value={id}>{CHAINS[id].name}</option>)}</select>}
      </div>
      <div className="hub-buy-amount">
        <label htmlFor="buy-amount">Amount in USD</label>
        <div className="hub-buy-amount-row"><span className="hub-buy-currency">$</span><input id="buy-amount" className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="50" /></div>
        <div className="hub-buy-presets">{PRESETS.map(p => <button key={p} type="button" className="hub-chip-button" aria-pressed={amount === p} onClick={() => setAmount(p)}>${p}</button>)}</div>
      </div>
      {wallets.length > 1 && <label className="hub-buy-wallet">From wallet<select className="socialtrading-input mono" value={wallet} onChange={e => setWallet(e.target.value)}>{wallets.map(w => <option key={w.address} value={w.address.toLowerCase()}>{shortAddress(w.address)} · {w.walletClientType === "privy" ? "embedded" : w.walletClientType}</option>)}</select></label>}
      {ready && wallets.length === 0 && <p className="hub-notice">Connect or create a wallet first (see Wallets). You’ll need USDC on {net.name} plus a little {net.nativeSymbol} for gas.</p>}
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-trade-actions">
        <button type="submit" className="button button-primary" disabled={!valid || busy || !wallets.length}>{busy ? "Getting your quote…" : `Buy ${USD.test(amount) ? usd(Number(amount), 2) : ""} of ${target.symbol.toUpperCase()}`}</button>
        <span className="socialtrading-caption">Pays {USD.test(amount) ? amount : "…"} USDC on {net.name}. You see the exact quote, then sign. Gas is extra.</span>
      </div>
    </form>}

    {tradeId && state.trades.some(t => t.id === tradeId) && <div className="hub-swap-result"><TradeCard tradeId={tradeId} /></div>}
  </section>;
}
