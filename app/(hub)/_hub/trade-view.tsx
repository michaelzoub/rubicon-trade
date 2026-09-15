"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { BuyPanel } from "./buy-panel";
import Link from "next/link";
import { PERMISSIONS } from "@/lib/socialtrading/profile";
import { remainingAllowance } from "@/lib/socialtrading/policy";
import { useHub } from "./hub-provider";
import { TradeCard } from "./parts";
import { SwapForm } from "./swap-form";
import { WalletsSection } from "./wallets";
import { usd } from "./format";

export function TradeView() {
  const { state, name } = useHub();
  const open = useMemo(() => state.trades.filter(t => t.crypto && t.crypto.phase !== "complete" && !["rejected", "blocked"].includes(t.status)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [state.trades]);
  const settled = useMemo(() => state.trades.filter(t => t.crypto && (t.crypto.phase === "complete" || ["rejected", "blocked"].includes(t.status))).slice(-5).reverse(), [state.trades]);
  const allowance = remainingAllowance(state.profile, state.trades);
  const mode = state.profile.permission;
  const [advanced, setAdvanced] = useState(false);
  return <div className="hub-trade-view">
    <header className="hub-view-head">
      <p className="eyebrow">Buy</p>
      <h1 className="landing-section-title">A little of what you believe in.</h1>
      <p>Find something you like. Choose an amount. Make it yours.</p>
    </header>
    <div className="hub-trade-columns">
      <div className="hub-trade-main">
        <BuyPanel title="Buy" />
        <section className="hub-advanced">
          <button type="button" className="hub-trade-raw-toggle" aria-expanded={advanced} onClick={() => setAdvanced(v => !v)}><ChevronDown size={12} aria-hidden="true" />More ways to buy</button>
          {advanced && <SwapForm title="Swap tokens" />}
        </section>
        {open.length > 0 && <section aria-labelledby="open-swaps">
          <h2 id="open-swaps" className="hub-section-title">In progress</h2>
          {open.length === 0 ? <p className="hub-empty">Nothing waiting on you. Swaps you or your agent set up appear here until they settle.</p> : <div className="hub-trade-list">{open.map(t => <TradeCard key={t.id} tradeId={t.id} />)}</div>}
        </section>}
        {settled.length > 0 && <section aria-labelledby="settled-swaps">
          <h2 id="settled-swaps" className="hub-section-title">Recently settled</h2>
          <div className="hub-trade-list">{settled.map(t => <TradeCard key={t.id} tradeId={t.id} />)}</div>
        </section>}
      </div>
      <aside className="hub-trade-side"><details className="hub-settings-card hub-wallet-profile"><summary><span className="hub-wallet-monogram">{(name || "You").slice(0, 1).toUpperCase()}</span><span><strong>{name || "Your account"}</strong><small>Wallet &amp; agent permissions</small></span></summary>
        <section className="hub-side-card" aria-labelledby="wallets-title">
          <h2 id="wallets-title" className="hub-section-title">Wallets</h2>
          <WalletsSection compact />
        </section>
        <section className="hub-side-card" aria-labelledby="agent-rules">
          <h2 id="agent-rules" className="hub-section-title">What your agent may do</h2>
          <p className="hub-side-mode">{PERMISSIONS[mode]}</p>
          <p className="hub-section-lead">{mode === "notify" ? "It can research and explain, but it cannot set up swaps. You can always trade yourself above." : mode === "approve" ? "It can propose swaps; each one waits for your signature." : "It can propose swaps within your limits; each one is reserved against them and still waits for your signature."}</p>
          {allowance && <dl className="hub-allowance">
            <div><dt>Per trade</dt><dd>{usd(allowance.perTrade, 2)}</dd></div>
            <div><dt>Left today</dt><dd>{usd(allowance.daily, 2)}</dd></div>
            <div><dt>Left this week</dt><dd>{usd(allowance.weekly, 2)}</dd></div>
          </dl>}
          <Link className="hub-inline-link" href="/profile">Edit permissions</Link>
        </section>
      </details></aside>
    </div>
  </div>;
}
