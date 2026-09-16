"use client";

import { announcePresence } from "@/lib/socialtrading/presence";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CHAINS, DEFAULT_CHAIN, explorerAddress, shortAddress, type ChainId } from "@/lib/crypto/chains";
import type { TokenMatch } from "@/lib/crypto/search";
import { useCelebration } from "../../_components/celebration";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { pct, usd } from "./format";
import { useHub } from "./hub-provider";
import { AssetLogo, TradeCard } from "./parts";

const PRESETS = ["25", "50", "100", "250"];
const USD = /^\d{1,7}(\.\d{1,2})?$/;

/** A literal buy: pick a token or tokenized stock, say how many dollars, sign in
 * your wallet. Pays with USDC on the token's chain through Uniswap. Same server
 * path as agent proposals, with `initiator: user`, so agent mode never blocks it.
 * Three moments: choose, amount, sign. Confirmation onchain is the celebration. */
export function BuyPanel({ preselected, title = "Buy", initialQuery = "", initialAmount = "50", onDone }: {
  /** Skip the search: buy this asset, e.g. from its detail page. */
  preselected?: { symbol: string; name: string; contracts: Record<string, string> };
  title?: string;
  initialQuery?: string; initialAmount?: string; onDone?: () => void;
}) {
  const { crypto, searchTokens, state } = useHub();
  const { wallets, ready } = useWallets();
  const { connectWallet } = usePrivy();
  const [balance, setBalance] = useState<{ usdc: number; native: number } | null>(null);
  const [balanceNote, setBalanceNote] = useState("Balance unavailable");
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<TokenMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<TokenMatch | null>(null);
  const [chainId, setChainId] = useState<ChainId>(DEFAULT_CHAIN);
  const [wallet, setWallet] = useState("");
  const [amount, setAmount] = useState(initialAmount);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; symbol: string } | null>(null);
  const module = useRef<HTMLElement>(null);
  const { celebrate, Celebration } = useCelebration();

  const presetChains = useMemo(() => preselected ? (Object.keys(preselected.contracts).map(Number).filter(id => id in CHAINS) as ChainId[]) : [], [preselected]);
  useEffect(() => { if (presetChains.length && !presetChains.includes(chainId)) setChainId(presetChains.includes(DEFAULT_CHAIN) ? DEFAULT_CHAIN : presetChains[0]); }, [presetChains, chainId]);
  useEffect(() => { if (!wallet && wallets[0]) setWallet(wallets[0].address.toLowerCase()); }, [wallets, wallet]);
  useEffect(() => {
    if (preselected || picked) return;
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
  }, [query, searchTokens, preselected, picked]);

  const target = preselected ? { symbol: preselected.symbol, name: preselected.name, chainId, address: preselected.contracts[String(chainId)] } : picked ? { symbol: picked.symbol, name: picked.name, chainId: picked.chainId, address: picked.address } : null;
  const net = target ? CHAINS[target.chainId] : null;
  const selectedWallet = wallets.find(w => w.address.toLowerCase() === wallet);
  useEffect(() => {
    let live = true;
    setBalance(null); setBalanceNote('Checking balance…');
    if (!selectedWallet || !net) { setBalanceNote('Connect a wallet to see your balance.'); return; }
    const network = net;
    (async () => {
      try {
        const provider = await selectedWallet.getEthereumProvider();
        const activeChain = await provider.request({ method: 'eth_chainId' });
        if (Number(activeChain) !== target?.chainId) { if (live) setBalanceNote(`Balance unavailable until your wallet is on ${network.name}.`); return; }
        const [usdc, native] = await Promise.all([
          provider.request({ method: 'eth_call', params: [{ to: network.usdc, data: `0x70a08231${wallet.slice(2).padStart(64, '0')}` }, 'latest'] }),
          provider.request({ method: 'eth_getBalance', params: [wallet, 'latest'] }),
        ]);
        if (typeof usdc !== 'string' || typeof native !== 'string') throw new Error('Unavailable');
        if (live) setBalance({ usdc: Number(BigInt(usdc))/1e6, native: Number(BigInt(native))/1e18 });
      } catch { if (live) setBalanceNote('Balance unavailable. Verify funds in your wallet before signing.'); }
    })();
    return () => { live = false; };
    // Refresh for the selected wallet/network, not unstable wallet hook objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet, target?.chainId, selectedWallet?.chainId]);

  const valid = (!balance || (balance.usdc >= Number(amount) && balance.native > 0)) && !!target && !!net && USD.test(amount) && Number(amount) > 0 && /^0x[0-9a-fA-F]{40}$/.test(wallet);
  const estimate = picked?.priceUsd && USD.test(amount) ? Number(amount) / picked.priceUsd : null;

  /** The purchase is complete when the chain says so. That is the moment worth a burst. */
  const trade = tradeId ? state.trades.find(t => t.id === tradeId) : undefined;
  const status = trade?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (status === "confirmed" && previous.current !== "confirmed" && trade) {
      setDone({ amount: trade.value, symbol: trade.asset.symbol });
      if (!onDone) celebrate(module.current?.querySelector(".hub-swap-result") ?? module.current);
    }
    previous.current = status;
  }, [status, trade, celebrate, onDone]);

  // Moments arrive rather than appear: results rise in a stagger, the amount stage lifts into place.
  const { contextSafe } = useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      if (results?.length && !picked) gsap.fromTo("[data-buy-result]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .4, stagger: .05, ease: rubiconMotion.ease.enter, clearProps: "all" });
      if (target) gsap.fromTo("[data-buy-stage]", { opacity: 0, y: 14, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .5, ease: rubiconMotion.ease.enter, clearProps: "all" });
      if (tradeId) gsap.fromTo(module.current, { boxShadow: "0 0 0 0 rgba(47, 128, 237, .35)" }, { boxShadow: "0 0 0 14px rgba(47, 128, 237, 0)", duration: 1.1, ease: "power2.out", clearProps: "boxShadow" });
    });
    return () => media.revert();
  }, { scope: module, dependencies: [results?.length, target?.address, tradeId], revertOnUpdate: true });
  const pop = contextSafe((node: HTMLElement) => { if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) gsap.fromTo(node, { scale: .9 }, { scale: 1, duration: .45, ease: "elastic.out(1, .6)", clearProps: "scale", overwrite: true }); });

  async function buy(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || submitting.current || !target || !net) return;
    submitting.current = true;
    setBusy(true); setError(""); setTradeId(null); setDone(null);
    try {
      announcePresence({ kind: "buy", asset: { id: `${target.chainId}:${target.address}`, symbol: target.symbol.toUpperCase(), name: target.name } });
      const result = await crypto({ action: "propose", chainId: target.chainId, wallet, tokenIn: net.usdc, tokenOut: target.address, amount, slippageBps: 50, note: `Buy ${usd(Number(amount), 2)} of ${target.symbol.toUpperCase()}` });
      if (result.tradeId) setTradeId(result.tradeId);
      else setError("No quote was returned. Nothing was submitted; try again.");
    } catch (err) { setError(err instanceof Error ? err.message : "The buy could not be set up."); }
    finally { submitting.current = false; setBusy(false); }
  }
  const reset = () => { setPicked(null); setTradeId(null); setDone(null); setQuery(""); setResults(null); };

  return <section ref={module} className={`hub-buy${target ? " has-target" : ""}${done ? " is-done" : ""}`} aria-labelledby="buy-title">
    <span className="hub-buy-light" aria-hidden="true" />
    <div className="hub-trade-head"><p id="buy-title" className="hub-part-title">{title}</p><span className="hub-trade-status">Pay with USDC</span></div>

    {!preselected && !picked && <div className="hub-buy-search">
      <label className="sr-only" htmlFor="buy-search">Search a token or tokenized stock</label>
      <div className="hub-buy-search-box"><Search size={15} aria-hidden="true" /><input id="buy-search" className="socialtrading-input" value={query} onChange={e => { setQuery(e.target.value); setTradeId(null); }} placeholder="What would you like to own?" autoComplete="off" spellCheck={false} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(null); }}><X size={13} /></button>}</div>
      {!query && <p className="hub-part-title hub-buy-suggestions-title">Available to buy</p>}
      {searching && results === null && <p className="hub-empty-inline" role="status">Finding assets…</p>}
      {error && <p className="hub-error" role="alert">{error}</p>}
      {results !== null && <ul className="hub-buy-results" role="listbox" aria-label="Matching tokens">
        {!searching && results.length === 0 && <li className="hub-empty-inline">No assets found. Try another name or symbol.</li>}
        {results.map(t => <li key={`${t.chainId}:${t.address}`} data-buy-result>
          <button type="button" role="option" aria-selected={false} className="hub-buy-result" onClick={() => { setPicked(t); setError(""); }}>
            <AssetLogo asset={{ symbol: t.symbol.toUpperCase() }} /><span className="hub-buy-result-id"><strong>{t.symbol.toUpperCase()}</strong><span>{t.name}</span></span>
            <span className="hub-buy-result-tags">{t.kind === "stock" && <span className="hub-label hub-label--emerging">Tokenized stock</span>}<span className="hub-label hub-label--related">{t.chain}</span>{t.thin && <span className="hub-label hub-label--muted">thin liquidity</span>}</span>
            <span className="hub-buy-result-price"><span>{usd(t.priceUsd)}</span><span className={`hub-change${(t.change24h ?? 0) > 0 ? " is-up" : (t.change24h ?? 0) < 0 ? " is-down" : ""}`}>{pct(t.change24h)}</span></span>
          </button>
        </li>)}
      </ul>}
    </div>}

    {target && net && !tradeId && <form className="hub-buy-form" data-buy-stage onSubmit={buy}>
      <div className="hub-buy-target">
        <AssetLogo asset={{ symbol: target.symbol.toUpperCase() }} />
        <div className="hub-buy-target-copy">
          <p className="hub-buy-target-symbol">{target.symbol.toUpperCase()} <span>· {target.name}</span></p>
          <p className="hub-buy-target-meta">on {net.name} · <a className="mono hub-inline-link" href={explorerAddress(target.chainId, target.address)} target="_blank" rel="noopener noreferrer">{shortAddress(target.address)}<ArrowUpRight size={11} aria-hidden="true" /></a>{picked?.thin ? " · thin liquidity, expect slippage" : ""}</p>
        </div>
        {!preselected && <button type="button" className="hub-chip-button" onClick={reset}>Change</button>}
        {preselected && presetChains.length > 1 && <select className="socialtrading-input hub-buy-chain" aria-label="Network" value={chainId} onChange={e => setChainId(Number(e.target.value) as ChainId)}>{presetChains.map(id => <option key={id} value={id}>{CHAINS[id].name}</option>)}</select>}
      </div>
      {picked?.kind === "stock" && <p className="purchase-requirements">Tokenized stock exposure · not brokerage shares. Review the issuer and contract before signing.</p>}
      <div className="hub-buy-amount">
        <label htmlFor="buy-amount">How much?</label>
        <div className="hub-buy-amount-row"><span className="hub-buy-currency">$</span><input id="buy-amount" className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="50" /></div>
        <div className="hub-buy-presets">{PRESETS.map(p => <button key={p} type="button" className="hub-chip-button" aria-pressed={amount === p} onClick={e => { setAmount(p); pop(e.currentTarget); }}>${p}</button>)}</div>
        {estimate !== null && <p className="hub-buy-estimate" aria-live="polite">≈ {estimate.toLocaleString("en-US", { maximumFractionDigits: estimate < 1 ? 6 : 4 })} {target.symbol.toUpperCase()} at today’s price</p>}
      </div>
      {wallets.length > 0 && <label className="hub-buy-wallet">From wallet<select className="socialtrading-input mono" value={wallet} onChange={e => setWallet(e.target.value)}>{wallets.map(w => <option key={w.address} value={w.address.toLowerCase()}>{shortAddress(w.address)} · {w.walletClientType === "privy" ? "embedded" : w.walletClientType}</option>)}</select></label>}
      {ready && wallets.length === 0 && <p className="hub-notice"><button type="button" className="hub-chip-button" onClick={() => connectWallet()}>Connect wallet</button> Connect or create a wallet in your profile first. You’ll need USDC on {net.name} plus a little {net.nativeSymbol} for gas.</p>}
      <p className="purchase-requirements" role="status">{balance ? `Available: ${balance.usdc.toLocaleString()} USDC · ${balance.native.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${net.nativeSymbol}` : balanceNote}</p>
      <p className="purchase-requirements">Required: {USD.test(amount) ? amount : "…"} USDC on {net.name}, plus {net.nativeSymbol} for network fees. Maximum slippage: 0.5%.</p>
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-trade-actions hub-buy-actions">
        <button type="submit" className="button button-primary hub-buy-submit" disabled={!valid || busy || !wallets.length}>{busy ? "Getting your quote…" : `Review ${USD.test(amount) ? usd(Number(amount), 2) : ""} of ${target.symbol.toUpperCase()}`}</button>
        <span className="socialtrading-caption">Pays {USD.test(amount) ? amount : "…"} USDC on {net.name}. You see the exact quote, then sign. Gas is extra.</span>
      </div>
    </form>}

    {done && <div className="hub-buy-done" role="status">
      <Sparkles size={16} aria-hidden="true" />
      <div><strong>It’s yours.</strong><span>{usd(done.amount, 2)} of {done.symbol.toUpperCase()} settled onchain from your wallet.</span></div>
      {onDone ? <button type="button" className="hub-chip-button" onClick={onDone}>Return to your world</button> : !preselected && <button type="button" className="hub-chip-button" onClick={reset}>Buy something else</button>}
    </div>}
    {tradeId && trade && ["rejected", "failed", "blocked"].includes(trade.status) && <button type="button" className="hub-chip-button" onClick={() => { setTradeId(null); setError(""); }}>Start a new quote</button>}
    {tradeId && trade && <div className="hub-swap-result"><TradeCard tradeId={tradeId} expanded={!!onDone} /></div>}
    {Celebration}
  </section>;
}
