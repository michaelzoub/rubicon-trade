"use client";

import { announcePresence } from "@/lib/socialtrading/presence";

import { usePrivy, useSign7702Authorization, useWallets } from "@privy-io/react-auth";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CHAINS, feeCap, formatUnits, type ChainId } from "@/lib/crypto/chains";
import { BUY_CHAIN } from "@/lib/crypto/tradable";
import { CATALOG, catalogEntry, primaryChain, type CatalogEntry } from "@/lib/crypto/catalog";
import { purchaseError } from "@/lib/crypto/readiness";
import type { ResolvedRoute } from "@/lib/crypto/route-resolver";
import { withCatalogMatches, type TokenMatch } from "@/lib/crypto/search";
import type { SignAuthorization } from "@/lib/crypto/gasless";
import { useCelebration } from "../../_components/celebration";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { usd } from "./format";
import { useHub } from "./hub-provider";
import { AssetLogo, TradeCard } from "./parts";
import { BuyTicker } from "./buy-ticker";
import { buyAmounts } from "./buy-amounts";
import { AgentMark } from "./agent-mark";
import { executePurchase, type PurchaseStage } from "./execute-purchase";
import { DepositFunds } from "./deposit-funds";
import { MarketQuote } from "./market-quote";
import "./buy-one.css";

const USD = /^\d{1,7}(\.\d{1,2})?$/;

type Target = { symbol: string; name: string; chainId: ChainId; address: string; kind?: "stock" | "crypto"; thin?: boolean; priceUsd?: number | null; decimals?: number; icon?: string };

const fromEntry = (entry: CatalogEntry): Target => {
  const chainId = primaryChain(entry);
  return { symbol: entry.symbol, name: entry.name, chainId, address: entry.contracts[chainId]!, kind: entry.kind, decimals: entry.decimals, icon: entry.icon };
};

/** The same work the trade card records, said as it is happening. Short lines,
 * present tense, no jargon: the person pressed one button and is watching their
 * agent do the rest. */
function spell(stage: PurchaseStage): string {
  switch (stage.kind) {
    case "switching": return "Getting your wallet ready";
    case "checking": return "Finding your funds";
    case "quoting": return "Locking in your price";
    case "permit": case "authorizing": case "signing": return "Signing it for you";
    case "submitted": case "broadcast": return "Sending it off";
  }
}

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
  const searchResults = useMemo(() => withCatalogMatches(query, results ?? []).filter(t => t.chainId === BUY_CHAIN), [query, results]);
  const [picked, setPicked] = useState<Target | null>(null);
  const [amount, setAmount] = useState(initialAmount);
  /** True once the person has said an amount themselves. */
  const touched = useRef(false);
  const [route, setRoute] = useState<ResolvedRoute | null>(null);
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [done, setDone] = useState<{ amount: number; symbol: string } | null>(null);
  /** What is happening right now, in the buyer's words. Null when nothing is. */
  const [run, setRun] = useState<string | null>(null);
  /** A step that has not moved in a minute and a half. */
  const [stalled, setStalled] = useState(false);
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const { signAuthorization } = useSign7702Authorization();
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const module = useRef<HTMLElement>(null);
  const { celebrate, Celebration } = useCelebration();

  const preset = useMemo<Target | null>(() => {
    if (!preselected) return null;
    // Cheapest supported chain wins when an asset lists on several.
    // Base only: an asset that does not list there is not offered for purchase,
    // and the card that opened this dialog already says so.
    const chainId = (Object.keys(preselected.contracts).map(Number).filter(id => id === BUY_CHAIN) as ChainId[])[0];
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
    setResults(null);
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
    // The previous answer stays up while a new one is fetched: the balance and
    // the amounts are drawn from it, and blanking them on every keystroke made
    // the row flicker. Nothing can be bought against a stale route — `valid`
    // requires the resolution to have finished.
    setResolving(true); setError("");
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

  /** What is in the wallet, and what a purchase can actually reach.
   *
   * The two differ by the network fee, which Circle's Paymaster takes out of
   * the same USDC — so the balance is what the person has, and `spendable` is
   * what the amounts may offer. Reserving the cap rather than today's cheaper
   * live fee is deliberate: the server checks the cap before it signs, and an
   * amount that passes here and fails there would be the worst of both. */
  const funded = (route?.candidates ?? []).filter(c => c.chainId === BUY_CHAIN)
    .reduce<string | null>((most, c) => most === null || BigInt(c.balance) > BigInt(most) ? c.balance : most, null);
  const balance = funded === null ? null : Number(funded) / 1e6;
  const spendable = funded === null ? null : Math.floor(Number(BigInt(funded) - feeCap(BUY_CHAIN)) / 1e4) / 100;
  const amounts = useMemo(() => buyAmounts(spendable), [spendable]);

  /** An opening amount nobody can afford is a dead button with a number on it.
   * Once the balance is known, an untouched default moves to the largest
   * amount on offer. Anything the person typed or chose is theirs and stays. */
  useEffect(() => {
    if (touched.current || spendable === null || !amounts.length) return;
    if (USD.test(amount) && Number(amount) > 0 && Number(amount) <= spendable) return;
    setAmount(amounts[amounts.length - 1]);
  }, [spendable, amounts, amount]);
  const mark = livePrice ?? picked?.priceUsd ?? null;
  const estimate = mark && USD.test(amount) ? Number(amount) / mark : null;

  /** Silence is the healthy state. A working purchase explains nothing: the
   * asset, the amount and the button already say it. This speaks only when
   * something needs the person — funds that cannot cover the buy, or none on
   * Base at all — because that is actionable and a disabled button is not. */
  const warning = (() => {
    if (!wallets.length || resolving || !route || chosen) return "";
    const here = route.candidates.find(c => c.chainId === BUY_CHAIN && BigInt(c.balance) > 0n);
    if (here) return `You have ${(Number(here.balance) / 1e6).toFixed(2)} USDC on ${CHAINS[BUY_CHAIN].name} — not enough for this buy.`;
    return `No USDC on ${CHAINS[BUY_CHAIN].name} yet. Send USDC to your wallet on ${CHAINS[BUY_CHAIN].name} and this is one tap.`;
  })();

  // A quote's output is in the token's own units. The tokenized stocks are 8
  // decimals, so assuming 18 would tell someone they were getting a ten-
  // billionth of what they are actually buying.
  const outDecimals = target?.decimals ?? (target ? catalogEntry(target.chainId, target.address)?.decimals : undefined) ?? null;
  const receives = chosen?.status === "available" && outDecimals !== null
    ? Number(formatUnits(chosen.outputAmount, outDecimals, 6).replace(/,/g, ""))
    : null;
  const valid = ready && !!target && !!chosen && USD.test(amount) && Number(amount) > 0 && !resolving;

  /** The purchase is complete when the chain says so. That is the moment worth a burst. */
  const trade = tradeId ? state.trades.find(t => t.id === tradeId) : undefined;
  /** Watching is only worth it while something is happening. A step that has
   * not moved in ninety seconds is no longer a moment — it is a purchase to
   * check on, and its card is where that is done. */
  useEffect(() => {
    if (!run) { setStalled(false); return; }
    const timer = setTimeout(() => setStalled(true), 90_000);
    return () => clearTimeout(timer);
  }, [run]);

  /** The purchase needs the person again: it ended badly, or it was signed and
   * nothing came back to follow. Its card is the only thing that knows how to
   * recover from either, so the panel steps aside and shows it. */
  const handback = !!tradeId && !!trade && !done && (!!error || ["failed", "rejected", "blocked"].includes(trade.status) || (trade.crypto?.phase === "issued" && (stalled || (!trade.crypto.hash && !run))));
  const status = trade?.status;
  const previous = useRef(status);
  useEffect(() => {
    if (status === "confirmed" && previous.current !== "confirmed" && trade) {
      setDone({ amount: trade.value, symbol: trade.asset.symbol });
      setRun(null); setBusy(false);
      if (!onDone) celebrate(module.current?.querySelector(".hub-buy-done") ?? module.current);
    }
    // Anything that ends without settling hands the purchase back to its card,
    // which is the one place that knows how to recover it.
    if (status && ["failed", "rejected", "blocked"].includes(status)) { setRun(null); setBusy(false); }
    previous.current = status;
  }, [status, trade, celebrate, onDone]);

  /** The chain answers when it answers. Until it does, this asks — so the wait
   * belongs to the panel the person is already looking at, rather than to a
   * card they would have to open. */
  useEffect(() => {
    const c = trade?.crypto;
    if (!tradeId || !trade || !c || c.phase !== "issued" || !c.hash) return;
    if (["confirmed", "failed", "rejected", "blocked"].includes(trade.status)) return;
    const timer = setInterval(() => { void crypto({ action: "status", tradeId }).catch(() => {}); }, 6000);
    return () => clearInterval(timer);
  }, [tradeId, trade, trade?.crypto?.phase, trade?.crypto?.hash, trade?.status, crypto]);

  // Moments arrive rather than appear.
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      if (!target) gsap.fromTo("[data-buy-item]", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .4, stagger: .03, ease: rubiconMotion.ease.enter, clearProps: "all" });
      // No scale here. Inside the purchase dialog this stage is already being
      // scaled by the dialog's own entrance, and two nested scales rasterize
      // the small type — the preset amounts especially — into a visible warp.
      else gsap.fromTo("[data-buy-stage]", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: module, dependencies: [results?.length, target?.address], revertOnUpdate: true });

  /** One press, the whole purchase.
   *
   * Everything between "yes" and "it's yours" is the agent's work, not a
   * checklist to hand back: the quote, the approvals, the signature, the
   * network fee out of the same USDC, the wait for the chain. A Rubicon wallet
   * signs without a second prompt, so from here the only thing the person does
   * is watch. Nothing is bypassed — the server still holds this to the quote,
   * the wallet and the policy limits — it simply is not asked twice.
   *
   * When something does need them, the purchase card appears with its recovery
   * paths intact. That is the only way this screen ever shows a second button. */
  async function buy(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy || submitting.current || !target || !chosen) return;
    submitting.current = true;
    setBusy(true); setError(""); setTradeId(null); setDone(null); setRun("Your agent is on it");
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
      const placed = result.tradeId ? result.state?.trades.find(t => t.id === result.tradeId) : undefined;
      if (!result.tradeId || !placed?.crypto) throw new Error("No quote was returned. Nothing was submitted; try again.");
      setTradeId(result.tradeId);
      await executePurchase(placed, "prepare", {
        crypto, signAuthorization: signAuthorization as SignAuthorization,
        wallets: () => walletsRef.current,
        onStage: stage => setRun(spell(stage)),
        onHash: (hash, step) => { try { localStorage.setItem(`rubicon:swap:${state.profile.userId}:${placed.id}:${step}`, hash); } catch { /* the card can still recover it */ } },
        onSubmitted: (op, step) => { try { localStorage.setItem(`rubicon:swap:${state.profile.userId}:${placed.id}:${step}:operation`, op); } catch { /* the card can still recover it */ } },
      });
      setRun("Almost yours");
    } catch (err) { setError(purchaseError(err)); setRun(null); setBusy(false); }
    finally { submitting.current = false; }
  }

  const reset = () => { touched.current = false; setPicked(null); setRoute(null); setTradeId(null); setDone(null); setQuery(""); setResults(null); setError(""); setRun(null); setStalled(false); setBusy(false); setLivePrice(null); };

  return <section ref={module} className={`hub-buy${target ? " has-target" : ""}${done ? " is-done" : ""}`} aria-label={target ? `Buy ${target.symbol.toUpperCase()}` : title}>
    <span className="hub-buy-light" aria-hidden="true" />
    {/* Once something is chosen its own plate names it, in type three times
      * this size. A heading above that says the same word twice. */}
    {!target && <div className="hub-trade-head"><p className="hub-part-title">{title}</p></div>}

    {!target && <div className="hub-buy-search">
      <label className="sr-only" htmlFor="buy-search">Search for something to buy</label>
      <div className="hub-buy-search-box"><Search size={15} aria-hidden="true" /><input id="buy-search" className="socialtrading-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="What would you like to own?" autoComplete="off" spellCheck={false} />{query && <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); setResults(null); }}><X size={13} /></button>}</div>
      {error && <p className="hub-error" role="alert">{error}</p>}

      {query.trim().length >= 2 ? <>
        {searching && results === null && !searchResults.length && <ul className="hub-buy-results hub-buy-results-waiting" aria-label="Searching" role="status">{[0, 1, 2].map(i => <li key={i}><span className="rubicon-skeleton hub-result-skeleton" /></li>)}</ul>}
        {(results !== null || searchResults.length > 0) && <ul className="hub-buy-results" aria-label="Search results">
          {!searching && !searchResults.length && <li className="hub-empty-inline">Nothing found. Try another name or symbol.</li>}
          {searchResults.map(t => <li key={`${t.chainId}:${t.address}`} data-buy-item>
            <button type="button" className="hub-buy-result" aria-label={`Buy ${t.symbol.toUpperCase()} on ${t.chain}`} onClick={() => setPicked({ symbol: t.symbol, name: t.name, chainId: t.chainId, address: t.address, kind: t.kind, thin: t.thin, priceUsd: t.priceUsd })}>
              <AssetLogo asset={{ symbol: t.symbol.toUpperCase(), logo: catalogEntry(t.chainId, t.address)?.icon }} />
              <span className="hub-buy-result-id"><strong>{t.symbol.toUpperCase()}</strong><span>{t.name}</span></span>
              <span className="hub-buy-result-tags">{t.kind === "stock" && <span className="hub-label hub-label--emerging">Tokenized stock</span>}<span className="hub-label hub-label--related">{t.chain}</span>{t.thin && <span className="hub-label hub-label--muted">thin liquidity</span>}</span>
              <MarketQuote chainId={t.chainId} contract={t.address} price={t.priceUsd} change={t.change24h} />
              <span className="hub-buy-result-go" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          </li>)}
        </ul>}
      </> : CATALOG.map(section => <div key={section.title} className="hub-buy-section">
        <p className="hub-part-title hub-buy-suggestions-title">{section.title}</p>
        {section.note && <p className="purchase-requirements">{section.note}</p>}
        <ul className="hub-buy-results" aria-label={section.title}>
          {section.entries.filter(entry => entry.contracts[BUY_CHAIN]).map(entry => <li key={entry.symbol} data-buy-item>
            <button type="button" className="hub-buy-result" aria-label={`Buy ${entry.symbol}`} onClick={() => setPicked(fromEntry(entry))}>
              <AssetLogo asset={{ symbol: entry.symbol.toUpperCase(), logo: entry.icon }} />
              <span className="hub-buy-result-id"><strong>{entry.symbol}</strong><span>{entry.name}</span></span>
              <span className="hub-buy-result-tags"><span className="hub-label hub-label--related">{CHAINS[primaryChain(entry)].name}</span></span>
              <MarketQuote chainId={primaryChain(entry)} contract={entry.contracts[primaryChain(entry)]!} />
              <span className="hub-buy-result-go" aria-hidden="true"><ChevronRight size={18} /></span>
            </button>
          </li>)}
        </ul>
      </div>)}
    </div>}

    {target && !done && <form className="hub-buy-form hub-buy-one" data-buy-stage onSubmit={buy}>
      <BuyTicker key={`${target.chainId}:${target.address}`} chainId={target.chainId} contract={target.address}
        symbol={target.symbol} name={target.name} logo={target.icon ?? catalogEntry(target.chainId, target.address)?.icon}
        seedPrice={target.priceUsd} onPrice={setLivePrice} />

      {/* The plate stays up throughout: while the agent works, and while the
        * purchase is waiting on the person. What changes is only what is under
        * it — the amount, the agent at work, or the card that needs an answer. */}
      {handback ? null : run
        ? <BuyRun line={run} />
        : <>
          <div className="hub-buy-amount">
            <div className="hub-buy-amount-head">
              <label htmlFor="buy-amount">You pay</label>
              {balance !== null && <span className="hub-buy-balance">{usd(balance, 2)} available</span>}
            </div>
            <div className="hub-buy-amount-row"><span className="hub-buy-currency">$</span><input id="buy-amount" className="socialtrading-input" inputMode="decimal" value={amount} onChange={e => { touched.current = true; setAmount(e.target.value.replace(/[^\d.]/g, "")); }} placeholder="50" /></div>
            {!!amounts.length && <div className="hub-buy-presets">{amounts.map(p => <button key={p} type="button" className="hub-chip-button" aria-pressed={amount === p} onClick={() => { touched.current = true; setAmount(p); }}>${p}</button>)}</div>}
            {receives !== null ? <p className="hub-buy-estimate" aria-live="polite">≈ {receives.toLocaleString("en-US", { maximumFractionDigits: receives < 1 ? 6 : 4 })} {target.symbol.toUpperCase()}</p>
              : estimate !== null && <p className="hub-buy-estimate" aria-live="polite">≈ {estimate.toLocaleString("en-US", { maximumFractionDigits: estimate < 1 ? 6 : 4 })} {target.symbol.toUpperCase()} at today’s price</p>}
          </div>

          {target.thin && <p className="hub-notice" role="status">Thin liquidity — expect slippage on this one.</p>}

          {/* Only when there is money missing. A wallet that has not been
            * connected yet is not a warning — it is what the button is for. */}
          {!!wallets.length && warning && <div className="hub-route">
            <p className="hub-notice" role="status">{warning}</p>
            <details><summary>Deposit USDC on Base</summary><DepositFunds /></details>
          </div>}
          {error && <p className="hub-error" role="alert">{error}</p>}

          <div className="hub-trade-actions hub-buy-actions">
            {/* One button, whatever the next thing is. A disabled control that
              * names the step it cannot take is a dead end with a label on it. */}
            {ready && !wallets.length
              ? <button type="button" className="button button-primary hub-buy-submit" onClick={() => connectWallet()}>Connect a wallet to buy</button>
              : <button type="submit" className="button button-primary hub-buy-submit" disabled={!valid || busy}>
                {resolving ? "Finding your funds" : !chosen ? "Can’t buy this yet" : `Buy ${USD.test(amount) ? usd(Number(amount), 2) : ""} of ${target.symbol.toUpperCase()}`}
              </button>}
            {!preset && <button type="button" className="hub-chip-button hub-buy-swap-target" onClick={reset}>Buy something else</button>}
          </div>
        </>}
    </form>}

    {done && <div className="hub-buy-done" role="status">
      <AgentMark expression="interacting" className="hub-buy-done-agent" />
      <div><strong>It’s yours.</strong><span>{usd(done.amount, 2)} of {done.symbol.toUpperCase()} is now in your portfolio.</span></div>
      {onDone ? <button type="button" className="hub-chip-button" onClick={onDone}>Return to your world</button> : !preset && <button type="button" className="hub-chip-button" onClick={reset}>Buy something else</button>}
    </div>}
    {/* The only time a second button appears: the purchase stopped needing the
      * agent and started needing the person. Its own card carries every way
      * back — check it, continue it, recover a hash the wallet already sent. */}
    {handback && tradeId && <div className="hub-buy-handback">
      {error && <p className="hub-error" role="alert">{error}</p>}
      <div className="hub-swap-result"><TradeCard tradeId={tradeId} expanded={false} simple quiet /></div>
      {trade && ["rejected", "failed", "blocked"].includes(trade.status) && <button type="button" className="hub-chip-button" onClick={() => { setTradeId(null); setError(""); }}>Try again</button>}
    </div>}
    {Celebration}
  </section>;
}

/**
 * The wait, made worth watching.
 *
 * Nothing here is a progress bar: the steps take as long as a network takes,
 * and pretending to measure them would be a lie told in pixels. What it shows
 * instead is attention — a light that breathes, a line that changes as the work
 * does, and the amount that is being spent, held steady underneath so the
 * person can see their own decision while it happens.
 */
function BuyRun({ line }: { line: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .45, ease: rubiconMotion.ease.enter });
      gsap.to(".hub-buy-run-agent", { scale: 1.06, y: -3, duration: 1.4, repeat: -1, yoyo: true, ease: rubiconMotion.ease.breath });
      gsap.fromTo("[data-run-sweep]", { xPercent: -140 }, { xPercent: 240, duration: 1.9, repeat: -1, ease: "power1.inOut" });
    });
    return () => media.revert();
  }, { scope: root });
  // Each line arrives rather than swaps: the work moved on, and the sentence
  // should look like it moved with it.
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-run-line]", { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .35, ease: rubiconMotion.ease.enter });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [line] });

  return <div ref={root} className="hub-buy-run" role="status" aria-live="polite">
    <AgentMark className="hub-buy-run-agent" />
    <strong data-run-line key={line}>{line}</strong>
    <span className="hub-buy-run-rail" aria-hidden="true"><span className="hub-buy-run-sweep" data-run-sweep /></span>
  </div>;
}
