"use client";

import { announcePresence } from "@/lib/socialtrading/presence";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ChevronRight, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { CHAINS, formatUnits, type ChainId } from "@/lib/crypto/chains";
import { CATALOG, primaryChain, type CatalogEntry } from "@/lib/crypto/catalog";
import { purchaseError } from "@/lib/crypto/readiness";
import type { ResolvedRoute } from "@/lib/crypto/route-resolver";
import type { TokenMatch } from "@/lib/crypto/search";
import { useCelebration } from "../../_components/celebration";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { pct, usd } from "./format";
import { useHub } from "./hub-provider";
import { AssetLogo, TradeCard } from "./parts";

const PRESETS = ["25", "50", "100", "250"];
const USD = /^\d{1,7}(\.\d{1,2})?$/;

type Target = { symbol: string; name: string; chainId: ChainId; address: string; kind?: "stock" | "crypto"; thin?: boolean; priceUsd?: number | null };

const fromEntry = (entry: CatalogEntry): Target => {
  const chainId = primaryChain(entry);
  return { symbol: entry.symbol, name: entry.name, chainId, address: entry.contracts[chainId]!, kind: entry.kind };
};

/** A literal buy: choose a thing, say how many dollars, sign once.
 *
 * Two moments, not three. Which network the money is on, which of your wallets
 * holds it, whether it has to cross a bridge and what that costs are resolved by
 * the server and stated in one sentence — never asked as questions. Same server
 * path as agent proposals, with `initiator: user`, so agent mode never blocks it.
 * Confirmation onchain is the celebration. */
export function BuyPanel({ preselected, title = "Buy", initialQuery = "", initialAmount = "50", onDone, onChoose }: {
  /** Skip the choosing: buy this asset, e.g. from its detail page. */
  preselected?: { symbol: string; name: string; contracts: Record<string, string> };
  title?: string;
  initialQuery?: string; initialAmount?: string; onDone?: () => void;
  /** The symbol actually being bought, so a surrounding dialog can stop
   * describing whatever opened it. Null once the choice is cleared. */
  onChoose?: (symbol: string | null) => void;
}) {
  const { crypto, searchTokens, state } = useHub();
  const { wallets, ready } = useWallets();
  const { connectWallet } = usePrivy();
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<TokenMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Target | null>(null);
  const [amount, setAmount] = useState(initialAmount);
  const [route, setRoute] = useState<ResolvedRoute | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; symbol: string } | null>(null);
  const module = useRef<HTMLElement>(null);
  const { celebrate, Celebration } = useCelebration();

  const preset = useMemo<Target | null>(() => {
    if (!preselected) return null;
    // Cheapest supported chain wins when an asset lists on several.
    const chainId = (Object.keys(preselected.contracts).map(Number).filter(id => id in CHAINS) as ChainId[])
      .sort((a, b) => (a === 8453 ? -1 : b === 8453 ? 1 : a - b))[0];
    return chainId ? { symbol: preselected.symbol, name: preselected.name, chainId, address: preselected.contracts[String(chainId)] } : null;
  }, [preselected]);
  const target = preset ?? picked;
  useEffect(() => { onChoose?.(target ? target.symbol.toUpperCase() : null); }, [target, onChoose]);

  useEffect(() => {
    if (target) return;
    let live = true;
    const q = query.trim();
    setError("");
    if (q.length < 2) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const handle = setTimeout(async () => {
      try { const list = await searchTokens(q); if (live) setResults(list); }
      catch (e) { if (live) { setResults([]); setError(e instanceof Error ? e.message : "Search failed."); } }
      finally { if (live) setSearching(false); }
    }, 300);
    return () => { live = false; clearTimeout(handle); };
  }, [query, searchTokens, target]);

  /** The whole readiness question, answered server-side: which wallet, which
   * network, whether it bridges, what it costs. Balances are read over RPC, so
   * the wallet is never asked to switch networks merely to find out whether a
   * purchase is possible — which is what used to make this feel manual. */
  useEffect(() => {
    if (!target || !wallets.length || !USD.test(amount) || Number(amount) <= 0 || tradeId) { setRoute(null); return; }
    let live = true;
    setResolving(true); setRoute(null); setError("");
    const handle = setTimeout(async () => {
      try {
        const result = await crypto({ action: "purchase_route", destinationChainId: target.chainId, tokenOut: target.address, amount });
        if (live && result.route) setRoute(result.route);
      } catch (e) { if (live) setError(purchaseError(e)); }
      finally { if (live) setResolving(false); }
    }, 400);
    return () => { live = false; clearTimeout(handle); };
    // Re-resolves for the asset, the amount and the connected wallets only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.chainId, target?.address, amount, wallets.length, tradeId]);

  const chosen = route?.chosen ?? null;
  const estimate = picked?.priceUsd && USD.test(amount) ? Number(amount) / picked.priceUsd : null;

  /** One sentence where a network picker, a wallet picker, two refresh buttons
   * and a fee disclosure used to be. When there is no route it says which
   * network holds the money and why it cannot reach this asset, because that is
   * actionable and a disabled button is not. */
  const routeLine = (() => {
    if (!wallets.length || resolving) return resolving ? "Finding your funds…" : "";
    if (!route) return "";
    if (!chosen) {
      const priced = route.candidates.find(c => c.status === "fee_exceeds_amount");
      if (priced) return `Your USDC is on ${CHAINS[priced.chainId as ChainId].name}, where moving ${usd(Number(amount), 2)} costs more than it is worth. Try a larger amount, or hold USDC on Base.`;
      const funded = route.candidates.filter(c => BigInt(c.balance) > 0n).sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)))[0];
      if (funded) return `You have ${(Number(funded.balance) / 1e6).toFixed(2)} USDC on ${CHAINS[funded.chainId as ChainId].name} — not enough for this buy.`;
      return "No USDC found in your wallets. Add USDC on Base to buy in a couple of taps.";
    }
    const where = CHAINS[chosen.chainId as ChainId].name;
    if (chosen.status === "same_chain") return `Paying from ${where} · fee comes out of your USDC`;
    const mins = chosen.status === "available" && chosen.timeEstimateMs ? Math.max(1, Math.ceil(chosen.timeEstimateMs / 60000)) : null;
    const fee = chosen.status === "available" && chosen.gasFeeUSD ? `$${Math.max(0.01, Number(chosen.gasFeeUSD)).toFixed(2)}` : null;
    return `Paying from ${where} → ${CHAINS[target!.chainId].name}${mins ? ` · about ${mins} min` : ""}${fee ? ` · fee ${fee}` : ""} · taken from your USDC`;
  })();

  /** The arithmetic behind the one-line answer, for anyone who wants to check it.
   * Every network the app looked at, what it holds, and why it was or was not
   * used — so "not enough" is never something you have to take on faith. */
  const breakdown = route ? [...route.candidates]
    .filter((c, i, all) => all.findIndex(o => o.chainId === c.chainId) === i)
    .sort((a, b) => Number(BigInt(b.balance) - BigInt(a.balance)) || a.chainId - b.chainId)
    .map(c => ({
      chainId: c.chainId,
      name: CHAINS[c.chainId as ChainId].name,
      balance: (Number(c.balance) / 1e6).toFixed(2),
      fee: (Number(c.reserve) / 1e6).toFixed(2),
      chosen: c === chosen,
      why: c.status === "same_chain" ? "Paying from here"
        : c.status === "available" ? "Route available"
        : c.status === "fee_exceeds_amount" ? "Fee is more than this buy"
        : c.status === "insufficient" ? (BigInt(c.balance) > 0n ? "Not enough USDC" : "No USDC")
        : c.reason.slice(0, 60),
    })) : [];

  const receives = chosen?.status === "available"
    ? Number(formatUnits(chosen.outputAmount, 18, 6).replace(/,/g, ""))
    : null;
  const valid = ready && !!target && !!chosen && USD.test(amount) && Number(amount) > 0 && !resolving;

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

  // Moments arrive rather than appear.
  const { contextSafe } = useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      if (!target) gsap.fromTo("[data-buy-item]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .4, stagger: .03, ease: rubiconMotion.ease.enter, clearProps: "all" });
      else gsap.fromTo("[data-buy-stage]", { opacity: 0, y: 14, scale: .985 }, { opacity: 1, y: 0, scale: 1, duration: .5, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: module, dependencies: [results?.length, target?.address], revertOnUpdate: true });
  const pop = contextSafe((node: HTMLElement) => { if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) gsap.fromTo(node, { scale: .9 }, { scale: 1, duration: .45, ease: "elastic.out(1, .6)", clearProps: "scale", overwrite: true }); });

  async function buy(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || submitting.current || !target || !chosen) return;
    submitting.current = true;
    setBusy(true); setError(""); setTradeId(null); setDone(null);
    try {
      announcePresence({ kind: "buy", asset: { id: `${target.chainId}:${target.address}`, symbol: target.symbol.toUpperCase(), name: target.name } });
      // A crossing sends the fee-reserved input the resolver already quoted, so
      // the plan matches the quote the user was shown.
      const result = await crypto({
        action: "propose", chainId: chosen.chainId, destinationChainId: target.chainId, wallet: chosen.wallet,
        tokenIn: CHAINS[chosen.chainId as ChainId].usdc, tokenOut: target.address,
        amount: chosen.status === "available" ? (Number(chosen.input) / 1e6).toFixed(6) : amount,
        slippageBps: 50, note: `Buy ${usd(Number(amount), 2)} of ${target.symbol.toUpperCase()}`,
      });
      if (result.tradeId) setTradeId(result.tradeId);
      else setError("No quote was returned. Nothing was submitted; try again.");
    } catch (err) { setError(purchaseError(err)); }
    finally { submitting.current = false; setBusy(false); }
  }
  const reset = () => { setPicked(null); setRoute(null); setTradeId(null); setDone(null); setQuery(""); setResults(null); setError(""); };

  return <section ref={module} className={`hub-buy${target ? " has-target" : ""}${done ? " is-done" : ""}`} aria-labelledby="buy-title">
    <span className="hub-buy-light" aria-hidden="true" />
    <div className="hub-trade-head"><p id="buy-title" className="hub-part-title">{target ? `Buy ${target.symbol.toUpperCase()}` : title}</p></div>

    {!target && <div className="hub-buy-search">
      <label className="sr-only" htmlFor="buy-search">Search for something to buy</label>
      <div className="hub-buy-search-box"><Search size={15} aria-hidden="true" /><input id="buy-search" className="socialtrading-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="What would you like to own?" autoComplete="off" spellCheck={false} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(null); }}><X size={13} /></button>}</div>
      {error && <p className="hub-error" role="alert">{error}</p>}

      {query.trim().length >= 2 ? <>
        {searching && results === null && <p className="hub-empty-inline" role="status">Searching…</p>}
        {results !== null && <ul className="hub-buy-results" aria-label="Search results">
          {!searching && !results.length && <li className="hub-empty-inline">Nothing found. Try another name or symbol.</li>}
          {results.map(t => <li key={`${t.chainId}:${t.address}`} data-buy-item>
            <button type="button" className="hub-buy-result" aria-label={`Buy ${t.symbol.toUpperCase()} on ${t.chain}`} onClick={() => setPicked({ symbol: t.symbol, name: t.name, chainId: t.chainId, address: t.address, kind: t.kind, thin: t.thin, priceUsd: t.priceUsd })}>
              <AssetLogo asset={{ symbol: t.symbol.toUpperCase() }} />
              <span className="hub-buy-result-id"><strong>{t.symbol.toUpperCase()}</strong><span>{t.name}</span></span>
              <span className="hub-buy-result-tags">{t.kind === "stock" && <span className="hub-label hub-label--emerging">Tokenized stock</span>}<span className="hub-label hub-label--related">{t.chain}</span>{t.thin && <span className="hub-label hub-label--muted">thin liquidity</span>}</span>
              <span className="hub-buy-result-price"><span>{usd(t.priceUsd)}</span><span className={`hub-change${(t.change24h ?? 0) > 0 ? " is-up" : (t.change24h ?? 0) < 0 ? " is-down" : ""}`}>{pct(t.change24h)}</span></span>
              <span className="hub-buy-result-go" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          </li>)}
        </ul>}
      </> : CATALOG.map(section => <div key={section.title} className="hub-buy-section">
        <p className="hub-part-title hub-buy-suggestions-title">{section.title}</p>
        {section.note && <p className="purchase-requirements">{section.note}</p>}
        <ul className="hub-buy-results" aria-label={section.title}>
          {section.entries.map(entry => <li key={entry.symbol} data-buy-item>
            <button type="button" className="hub-buy-result" aria-label={`Buy ${entry.symbol.toUpperCase()}`} onClick={() => setPicked(fromEntry(entry))}>
              <AssetLogo asset={{ symbol: entry.symbol.toUpperCase() }} />
              <span className="hub-buy-result-id"><strong>{entry.symbol.toUpperCase()}</strong><span>{entry.name}</span></span>
              <span className="hub-buy-result-tags"><span className="hub-label hub-label--related">{CHAINS[primaryChain(entry)].name}</span></span>
              <span className="hub-buy-result-go" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          </li>)}
        </ul>
      </div>)}
    </div>}

    {target && !tradeId && <form className="hub-buy-form" data-buy-stage onSubmit={buy}>
      <div className="hub-buy-target">
        <AssetLogo asset={{ symbol: target.symbol.toUpperCase() }} />
        <div className="hub-buy-target-copy">
          <p className="hub-buy-target-symbol">{target.symbol.toUpperCase()} <span>{target.name}</span></p>
        </div>
        {!preset && <button type="button" className="hub-chip-button" onClick={reset}>Change</button>}
      </div>

      <div className="hub-buy-amount">
        <label htmlFor="buy-amount">You pay</label>
        <div className="hub-buy-amount-row"><span className="hub-buy-currency">$</span><input id="buy-amount" style={{ "--amount-width": `${Math.max(2, amount.length) + .5}ch` } as CSSProperties} className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="50" /></div>
        <div className="hub-buy-presets">{PRESETS.map(p => <button key={p} type="button" className="hub-chip-button" aria-pressed={amount === p} onClick={e => { setAmount(p); pop(e.currentTarget); }}>${p}</button>)}</div>
        {receives !== null ? <p className="hub-buy-estimate" aria-live="polite">≈ {receives.toLocaleString("en-US", { maximumFractionDigits: receives < 1 ? 6 : 4 })} {target.symbol.toUpperCase()}</p>
          : estimate !== null && <p className="hub-buy-estimate" aria-live="polite">≈ {estimate.toLocaleString("en-US", { maximumFractionDigits: estimate < 1 ? 6 : 4 })} {target.symbol.toUpperCase()} at today’s price</p>}
      </div>

      {target.kind === "stock" && <p className="purchase-requirements">Tokenized stock exposure · not brokerage shares.</p>}
      {target.thin && <p className="purchase-requirements">Thin liquidity — expect slippage on this one.</p>}

      {ready && !wallets.length
        ? <p className="hub-notice"><button type="button" className="hub-chip-button" onClick={() => connectWallet()}>Connect wallet</button> Connect a wallet to buy.</p>
        : routeLine && <div className="hub-route">
          <p className={chosen || resolving ? "purchase-requirements" : "hub-notice"} role="status">{routeLine}</p>
          {breakdown.length > 0 && <details className="hub-route-detail">
            <summary>Where your money is</summary>
            <ul>{breakdown.map(row => <li key={row.chainId} data-chosen={row.chosen || undefined}>
              <span className="hub-route-net">{row.name}</span>
              <span className="hub-route-bal">${row.balance}</span>
              <span className="hub-route-why">{row.why}</span>
              <span className="hub-route-fee">fee ${row.fee}</span>
            </li>)}</ul>
          </details>}
        </div>}
      {error && <p className="hub-error" role="alert">{error}</p>}

      <div className="hub-trade-actions hub-buy-actions">
        <button type="submit" className="button button-primary hub-buy-submit" disabled={!valid || busy}>
          {busy ? "Getting your quote…" : resolving ? "Finding your funds…" : !wallets.length ? "Connect a wallet" : !chosen ? "Can’t buy this yet" : `Buy ${USD.test(amount) ? usd(Number(amount), 2) : ""} of ${target.symbol.toUpperCase()}`}
        </button>
      </div>
    </form>}

    {done && <div className="hub-buy-done" role="status">
      <Sparkles size={16} aria-hidden="true" />
      <div><strong>It’s yours.</strong><span>{usd(done.amount, 2)} of {done.symbol.toUpperCase()} settled onchain from your wallet.</span></div>
      {onDone ? <button type="button" className="hub-chip-button" onClick={onDone}>Return to your world</button> : !preset && <button type="button" className="hub-chip-button" onClick={reset}>Buy something else</button>}
    </div>}
    {tradeId && trade && ["rejected", "failed", "blocked"].includes(trade.status) && <button type="button" className="hub-chip-button" onClick={() => { setTradeId(null); setError(""); }}>Start a new quote</button>}
    {tradeId && trade && <div className="hub-swap-result"><TradeCard tradeId={tradeId} expanded={false} /></div>}
    {Celebration}
  </section>;
}
