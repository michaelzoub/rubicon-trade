"use client";

import { SpatialMarket } from "./worldview";
import { Flame, Search, Shapes, Sparkles, Sprout } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Asset } from "@/lib/socialtrading/types";
import { isThemeId, THEMES } from "@/lib/socialtrading/themes";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { ThemeMark } from "../theme-cards";
import { useHub } from "./hub-provider";
import { Lens, type LensItem } from "./lens";
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
  const [lens, setLens] = useState<LensId>("forYou");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState("");
  const results = useRef<HTMLElement>(null);
  const search = query.trim();

  const forYou = useCallback(async (q: string) => {
    const [stocks, coins] = await Promise.allSettled([market({ kind: "stock", q }), market({ kind: "crypto", q })]);
    if (stocks.status === "rejected" && coins.status === "rejected") throw stocks.reason;
    return mergeKinds(stocks.status === "fulfilled" ? stocks.value : [], coins.status === "fulfilled" ? coins.value : []);
  }, [market]);

  useEffect(() => {
    if (lens === "themes" && !theme) { setAssets(null); return; }
    let cancelled = false;
    setError(""); setAssets(null);
    const load = lens === "forYou" ? () => forYou(search) : lens === "themes" ? () => market({ kind: "stock", q: theme ?? "" }) : () => market({ kind: lens === "new" ? "ipos" : "trends", q: "" });
    const handle = setTimeout(() => {
      load().then(list => {
        if (cancelled) return;
        setAssets(list);
      }).catch(e => { if (!cancelled) { setAssets([]); setError(e instanceof Error ? e.message : "Market data is unavailable."); } });
    }, search ? 350 : 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [forYou, market, lens, search, theme]);

  const affinity = useMemo(() => THEMES.map(t => {
    const learned = state.inferred.find(i => i.id === t.id);
    return { ...t, explicit: state.profile.themes.includes(t.id), weight: learned?.weight ?? 0, confidence: learned?.confidence ?? 0 };
  }).sort((a, b) => Number(b.explicit) - Number(a.explicit) || b.weight * b.confidence - a.weight * a.confidence), [state.inferred, state.profile.themes]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(results.current, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .5, ease: rubiconMotion.ease.enter, clearProps: "all" });
    });
    return () => media.revert();
  }, { dependencies: [lens, theme], revertOnUpdate: true });

  const themeName = THEMES.find(t => t.id === theme)?.name;
  const heading = lens === "new" ? "New to the market" : lens === "moving" ? "Moving in stocks & crypto" : lens === "themes" ? (theme ? `${themeName ?? theme} in your world` : "") : search ? `Results for “${search}”` : "Picked for you";
  const showing = lens !== "themes" || !!theme;

  return (
    <div className="hub-explore">
      <section className="hub-explore-hero" aria-label="Explore">
        <header className="hub-view-head hub-explore-copy">
          <p className="eyebrow">Explore</p>
          <h1 className="landing-section-title">The market, through your eyes.</h1>
          <p>Ideas come closer as they connect to what you believe.</p>
        </header>

      </section>

      <div className="hub-explore-controls">
        <Lens items={LENSES} value={lens} label="Ways to explore" onChange={id => { setLens(id); setTheme(null); setQuery(""); }} />
        {lens === "forYou" && <label className="hub-search hub-explore-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search stocks and crypto</span>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="A company, a coin, or an idea" maxLength={100} /></label>}
      </div>

      {lens === "forYou" && !search && <SpatialMarket assets={assets ?? []} />}

      {lens === "themes" && <div className="hub-orbs" role="group" aria-label="Themes">
        {affinity.map(t => {
          const note = t.explicit ? "You chose this" : t.confidence >= .4 && t.weight > .3 ? `Noticed you exploring · ${Math.round(t.weight * 100)}%` : t.weight < -.15 && t.confidence >= .4 ? "You usually skip this" : t.note;
          return <button key={t.id} type="button" className={`hub-orb${theme === t.id ? " is-active" : ""}${t.explicit ? " is-yours" : ""}`} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}
            style={{ "--theme-color": t.color, "--theme-light": t.light, "--theme-dark": t.dark } as CSSProperties}>
            <span className="hub-orb-disc" aria-hidden="true"><ThemeMark theme={t.id} /></span>
            <strong>{t.name}</strong><small>{note}</small>
          </button>;
        })}
      </div>}

      <section ref={results} className="hub-explore-results" aria-live="polite">
        {showing && heading && <p className="hub-part-title">{heading}</p>}
        {assets === null && showing && <div className="hub-skeleton-grid" aria-label="Loading" role="status">{[0, 1, 2, 3].map(i => <span key={i} className="rubicon-skeleton hub-skeleton" />)}</div>}
        {assets && assets.length > 0 && (lens === "forYou" && !search ? <details className="gravity-all"><summary>All {assets.length} discoveries</summary><AssetGrid assets={assets} /></details> : <AssetGrid assets={assets} discovery />)}
        {assets && assets.length === 0 && <div className="hub-empty">
          <p>{error || (search ? "Nothing matched. Try a company name, a ticker, or an idea." : "Nothing here yet.")}</p>
          {search && <button type="button" className="hub-chip-button" onClick={() => { setDraft(""); void send(`Find me something related to ${search}`); }}>Ask your agent about “{search}”</button>}
        </div>}
        {lens === "themes" && !theme && <p className="hub-empty">Pick a theme and your agent lines up what fits.</p>}
      </section>
      {isThemeId(theme) && <p className="hub-explore-note">Want more like this? Tell your agent: <button type="button" className="hub-inline-link" onClick={() => void send(`I’m becoming more interested in ${themeName?.toLowerCase()}`)}>“I’m becoming more interested in {themeName?.toLowerCase()}”</button></p>}
    </div>
  );
}
