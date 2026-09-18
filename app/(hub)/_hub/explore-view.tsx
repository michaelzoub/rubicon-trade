"use client";

import { Constellation, constellation } from "./explore-hero";
import { Flame, Search, Shapes, Sparkles, Sprout } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { THEMES } from "@/lib/socialtrading/themes";
import { ThemeMark } from "../theme-cards";
import { useGloss } from "./gloss";
import { useHub } from "./hub-provider";
import { isTradable } from "@/lib/crypto/tradable";
import { Lens, type LensItem } from "./lens";
import { openPurchase } from "./purchase";
import { AssetGrid } from "./parts";

/** Four ways of looking, not four filters. Stocks and crypto travel together under every lens. */
const LENSES = [
  { id: "forYou", label: "For you", icon: Sparkles, hue: "#2f80ed" },
  { id: "themes", label: "Themes", icon: Shapes, hue: "#7c6bd6" },
  { id: "new", label: "New", icon: Sprout, hue: "#2fa38a" },
  { id: "moving", label: "Moving", icon: Flame, hue: "#d98a3a" },
] as const satisfies readonly LensItem<string>[];
type LensId = typeof LENSES[number]["id"];

/** Stocks and coins in one ranking. With scores, the agent's order wins; without, they alternate so neither kind buries the other. */
export function mergeKinds(stocks: Asset[], coins: Asset[]): Asset[] {
  if ([...stocks, ...coins].some(a => typeof a.score === "number")) return [...stocks, ...coins].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const out: Asset[] = [];
  for (let i = 0; i < Math.max(stocks.length, coins.length); i++) { if (stocks[i]) out.push(stocks[i]); if (coins[i]) out.push(coins[i]); }
  return out;
}

export function ExploreView() {
  const { market, state, send, setDraft } = useHub();
  const gloss = useGloss();
  const [lens, setLens] = useState<LensId>("forYou");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  /** Something newer is on its way. What is on screen dims and waits rather than vanishing. */
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const search = query.trim();
  /** The field as it stands, taken the moment before a change, so the same
   * objects can be seen travelling to their new places. */


  const buyableFirst = useCallback((list: Asset[]) => {
    const rank = (a: Asset) => (isTradable({ symbol: a.symbol, name: a.name, kind: a.kind, contracts: a.contracts }) ? 0 : 1);
    // A stable partition: relevance order survives inside each group.
    return [...list].sort((a, b) => rank(a) - rank(b));
  }, []);

  const forYou = useCallback(async (q: string) => {
    const [stocks, coins] = await Promise.allSettled([market({ kind: "stock", q }), market({ kind: "crypto", q })]);
    if (stocks.status === "rejected" && coins.status === "rejected") throw stocks.reason;
    return mergeKinds(stocks.status === "fulfilled" ? stocks.value : [], coins.status === "fulfilled" ? coins.value : []);
  }, [market]);

  useEffect(() => {
    if (lens === "themes" && !theme) { setAssets(null); setLoading(false); return; }
    let cancelled = false;
    setError(""); setLoading(true);
    const load = lens === "forYou" ? () => forYou(search) : lens === "themes" ? () => market({ kind: "stock", q: theme ?? "" }) : () => market({ kind: lens === "new" ? "ipos" : "trends", q: "" });
    const handle = setTimeout(() => {
      load().then(list => {
        if (cancelled) return;
        // What you can actually buy comes first. Everything else keeps its place
        // — following a stock with no tokenized market is still worth something —
        // and its card says plainly that Rubicon cannot buy it yet.
        setAssets(buyableFirst(list)); setLoading(false);
      }).catch(e => { if (!cancelled) { setAssets([]); setLoading(false); setError(e instanceof Error ? e.message : "Market data is unavailable."); } });
    }, search ? 350 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [forYou, market, lens, search, theme]);

  const affinity = useMemo(() => THEMES.map(t => {
    const learned = state.inferred.find(i => i.id === t.id);
    return { ...t, explicit: state.profile.themes.includes(t.id), weight: learned?.weight ?? 0, confidence: learned?.confidence ?? 0 };
  }).sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.weight * b.confidence - a.weight * a.confidence), [state.inferred, state.profile.themes]);

  const change = (next: () => void) => { next(); };

  return (
    <div className={`hub-explore${loading && assets ? " is-loading" : ""}`}>
      <div className="hub-portfolio-entry"><button type="button" className="hub-chip-button" onClick={() => openPurchase({ side: "sell" })}>Your tokens · Sell</button></div>
      <div className="hub-explore-controls">
        <Lens className="hub-discovery-lenses" items={LENSES} value={lens} label="Ways to explore" onChange={id => change(() => { setLens(id); setTheme(null); setQuery(""); })} />
        {lens === "forYou" && <label className="hub-search hub-explore-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search stocks and crypto</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="A company, a coin, or an idea" maxLength={100} /></label>}
      </div>

      {lens === "themes" && <div className="hub-orbs" role="group" aria-label="Themes">
        {affinity.map(t => {
          const standing = t.explicit ? "You chose this"
            : t.confidence >= .4 && t.weight > .3 ? `Noticed you exploring · ${Math.round(t.weight * 100)}%`
            : t.weight < -.15 && t.confidence >= .4 ? "You usually skip this" : t.note;
          return <button key={t.id} type="button" className={`hub-orb${theme === t.id ? " is-active" : ""}${t.explicit ? " is-yours" : ""}`} aria-pressed={theme === t.id}
            onClick={() => change(() => setTheme(t.id))}
            {...gloss({ title: t.name, lines: [{ label: "Where you stand", value: standing }, { label: "Agent confidence", value: t.confidence ? `${Math.round(t.confidence * 100)}%` : "Not established" }] })}
            style={{ "--theme-color": t.color, "--theme-light": t.light, "--theme-dark": t.dark } as CSSProperties}>
            <span className="hub-orb-disc" aria-hidden="true"><ThemeMark theme={t.id} /></span>
            <strong>{t.name}</strong>
          </button>;
        })}
      </div>}

      {assets && assets.length > 0 && <Constellation assets={constellation(assets)} />}

      <section className="hub-explore-results" aria-live="polite">
        {assets === null && (lens !== "themes" || theme) && <div className="hub-skeleton-grid" aria-label="Loading" role="status">{[0, 1, 2, 3].map(i => <span key={i} className="rubicon-skeleton hub-skeleton" />)}</div>}
        {assets && assets.length > 0 && <AssetGrid assets={assets} quiet />}
        {assets && assets.length === 0 && <div className="hub-empty">
          <p>{error || (search ? "Nothing matched. Try a company name, a ticker, or an idea." : "Nothing here yet.")}</p>
          {search && <button type="button" className="hub-chip-button" onClick={() => { setDraft(""); void send(`Find me something related to ${search}`); }}>Ask your agent about “{search}”</button>}
        </div>}
      </section>
    </div>
  );
}
