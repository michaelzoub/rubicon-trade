"use client";

import { useRef, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { THEMES, suggestedThemes, type ThemeId } from "@/lib/socialtrading/themes";
import { gsap, useGSAP, rubiconMotion } from "../_components/motion";

export function ThemeMark({ theme }: { theme: ThemeId }) {
  return <svg viewBox="0 0 40 40" className="socialtrading-theme-mark" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    {theme === "energy" && <><path d="M23 5 10 23h9l-2 12 13-19h-9Z" fill="currentColor" fillOpacity=".12" /><path d="M7 9h5m16 22h5M5 15h3m25 10h3" opacity=".5" /></>}
    {theme === "tech" && <><rect x="11" y="11" width="18" height="18" rx="3" fill="currentColor" fillOpacity=".1" /><rect x="16" y="16" width="8" height="8" rx="1" /><path d="M15 6v5m10-5v5m-10 18v5m10-5v5M6 15h5m-5 10h5m18-10h5m-5 10h5" /></>}
    {theme === "ai" && <><path d="M20 5 24 16l11 4-11 4-4 11-4-11L5 20l11-4Z" fill="currentColor" fillOpacity=".12" /><path d="M29 6v6m-3-3h6M8 29v5m-2.5-2.5h5" opacity=".5" /></>}
    {theme === "crypto" && <><path d="m20 5 12 7v15l-12 8-12-8V12Z" fill="currentColor" fillOpacity=".1" /><path d="m20 12 7 4v8l-7 4-7-4v-8Z" /><path d="M20 12v16m-7-12 14 8m0-8-14 8" opacity=".6" /></>}
    {theme === "healthcare" && <><path d="M10 6q20 5 20 28M30 6Q10 11 10 34" /><path d="M13 10h14m-11 6h8m-8 8h8m-11 6h14" opacity=".55" /></>}
    {theme === "consumer" && <><rect x="8" y="13" width="24" height="21" rx="6" fill="currentColor" fillOpacity=".1" /><path d="M14 15V11a6 6 0 0 1 12 0v4" /><path d="M16 24q4 4 8 0" /></>}
  </svg>;
}

export function ThemeCards({ selected, thesis, onChange }: { selected: ThemeId[]; thesis: string; onChange: (themes: ThemeId[]) => void }) {
  const root = useRef<HTMLFieldSetElement>(null);
  const suggested = suggestedThemes(thesis);
  const { contextSafe } = useGSAP({ scope: root });
  const select = contextSafe((theme: ThemeId, element: HTMLElement) => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(element.querySelector("svg"), { scale: .94, y: 2 }, {
        scale: 1, y: 0, duration: .36, ease: rubiconMotion.ease.enter, clearProps: "all", overwrite: true,
      });
    }
    onChange(selected.includes(theme) ? selected.filter(t => t !== theme) : [...selected, theme]);
  });
  return <fieldset ref={root} className="socialtrading-theme-grid">
    <legend className="sr-only">Your core interests — choose any combination</legend>
    {THEMES.map(theme => <button type="button" key={theme.id} aria-label={theme.name} aria-pressed={selected.includes(theme.id)}
      className="socialtrading-theme-card" style={{ "--theme-color": theme.color, "--theme-light": theme.light } as CSSProperties}
      onClick={e => select(theme.id, e.currentTarget)}>
      <ThemeMark theme={theme.id} />
      <span className="socialtrading-theme-copy"><strong>{theme.name}</strong><small>{theme.note}</small></span>
      <span className="socialtrading-theme-state" aria-hidden="true">{selected.includes(theme.id) ? <Check size={12} /> : suggested.includes(theme.id) ? <span className="socialtrading-theme-hint" /> : null}</span>
    </button>)}
  </fieldset>;
}
