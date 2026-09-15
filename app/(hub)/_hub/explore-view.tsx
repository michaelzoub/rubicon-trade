"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { isThemeId, THEMES } from "@/lib/socialtrading/themes";
import { useHub } from "./hub-provider";
import { AssetGrid } from "./parts";

const TABS = [
  { id: "stock", label: "Stocks" }, { id: "crypto", label: "Crypto" }, { id: "themes", label: "Themes" }, { id: "ipos", label: "IPOs" }, { id: "trends", label: "Trends" },
] as const;
type Tab = typeof TABS[number]["id"];

export function ExploreView() {
  const { market, state, send, setDraft } = useHub();
  const [tab, setTab] = useState<Tab>("stock");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState("");
  const search = query.trim();

  useEffect(() => {
    if (tab === "themes" && !theme) { setAssets(null); return; }
    let cancelled = false;
    setError(""); setAssets(null);
    const params: Record<string, string> = tab === "themes" ? { kind: "stock", q: theme ?? "" } : { kind: tab, q: search };
    const handle = setTimeout(() => {
      market(params).then(list => { if (!cancelled) setAssets(list); }).catch(e => { if (!cancelled) { setAssets([]); setError(e instanceof Error ? e.message : "Market data is unavailable."); } });
    }, search ? 350 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [market, tab, search, theme]);

  const affinity = useMemo(() => THEMES.map(t => {
    const learned = state.inferred.find(i => i.id === t.id);
    return { ...t, explicit: state.profile.themes.includes(t.id), weight: learned?.weight ?? 0, confidence: learned?.confidence ?? 0 };
  }).sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.weight * b.confidence - a.weight * a.confidence), [state.inferred, state.profile.themes]);

  const heading = tab === "ipos" ? "New to the market" : tab === "trends" ? "Moving in stocks & crypto" : tab === "themes" ? (theme ? `${THEMES.find(t => t.id === theme)?.name ?? theme} in your world` : "Themes your agent tracks for you") : search ? `Results for “${search}”` : "Picked for you";

  return (
    <div className="hub-explore">
      <header className="hub-view-head">
        <p className="eyebrow">Explore</p>
        <h1 className="landing-section-title">Find your next interest.</h1>
        <p>Companies, coins, and ideas worth a closer look.</p>
      </header>
      <div className="hub-tabs" role="tablist" aria-label="Explore categories">
        {TABS.map(t => <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={`hub-tab${tab === t.id ? " is-active" : ""}`} onClick={() => { setTab(t.id); setTheme(null); setQuery(""); }}>{t.label}</button>)}
      </div>
      {(tab === "stock" || tab === "crypto") && <label className="hub-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search {tab === "stock" ? "stocks" : "crypto"}</span>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === "stock" ? "Company, ticker, or idea" : "Coin, token, or category"} maxLength={100} /></label>}
      {tab === "themes" && <div className="hub-theme-list">
        {affinity.map(t => <button key={t.id} type="button" className={`hub-theme${theme === t.id ? " is-active" : ""}`} onClick={() => setTheme(t.id)} style={{ "--theme-color": t.color, "--theme-light": t.light } as React.CSSProperties}>
          <span className="hub-theme-mark" aria-hidden="true" />
          <span className="hub-theme-copy"><strong>{t.name}</strong><small>{t.explicit ? "You chose this" : t.confidence >= .4 && t.weight > .3 ? `Noticed you exploring · ${Math.round(t.weight * 100)}%` : t.weight < -.15 && t.confidence >= .4 ? "You usually skip this" : t.note}</small></span>
          {t.explicit ? <span className="hub-label hub-label--match">Yours</span> : t.confidence >= .4 && t.weight > .3 ? <span className="hub-label hub-label--related">Learned</span> : null}
        </button>)}
      </div>}
      <section className="hub-explore-results" aria-live="polite">
        {(tab !== "themes" || theme) && <p className="hub-part-title">{heading}</p>}
        {assets === null && (tab !== "themes" || theme) && <div className="hub-skeleton-grid" aria-label="Loading" role="status">{[0, 1, 2, 3].map(i => <span key={i} className="rubicon-skeleton hub-skeleton" />)}</div>}
        {assets && assets.length > 0 && <AssetGrid assets={assets} discovery />}
        {assets && assets.length === 0 && <div className="hub-empty">
          <p>{error || (search ? "Nothing matched. Try a company name, a ticker, or an idea." : "Nothing here yet.")}</p>
          {search && <button type="button" className="hub-chip-button" onClick={() => { setDraft(""); void send(`Find me something related to ${search}`); }}>Ask your agent about “{search}”</button>}
        </div>}
      </section>
      {isThemeId(theme) && <p className="hub-explore-note">Want more like this? Tell your agent: <button type="button" className="hub-inline-link" onClick={() => void send(`I’m becoming more interested in ${THEMES.find(t => t.id === theme)?.name.toLowerCase()}`)}>“I’m becoming more interested in {THEMES.find(t => t.id === theme)?.name.toLowerCase()}”</button></p>}
    </div>
  );
}
