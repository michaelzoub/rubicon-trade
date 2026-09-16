"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { convictionsOf, relevance } from "@/lib/socialtrading/worldview";
import { THEMES } from "@/lib/socialtrading/themes";
import type { Asset, HubState } from "@/lib/socialtrading/types";
import { gsap, prefersReducedMotion } from "../../_components/motion";
import "./gloss.css";

/** One revealed fact. `label` names the kind of thing, `value` is the thing. */
export type GlossLine = { label: string; value: string };
export type GlossContent = { title?: string; lines: GlossLine[] };

type Active = { content: GlossContent; rect: DOMRect };

const GlossContext = createContext<{
  show: (content: GlossContent, element: Element) => void;
  hide: () => void;
} | null>(null);

/** How long a pointer must rest before anything appears. Short enough to feel
 * immediate, long enough that crossing a card does not flash a surface. */
const INTENT = 90;

export const GLOSS_ID = "rubicon-gloss";

export function GlossProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback((content: GlossContent, element: Element) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const rect = element.getBoundingClientRect();
      setActive({ content, rect });
      // The agent turns toward what is being read, from wherever it is.
      window.dispatchEvent(new CustomEvent("rubicon:attend", { detail: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } }));
    }, INTENT);
  }, []);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setActive(null);
      window.dispatchEvent(new CustomEvent("rubicon:attend", { detail: null }));
    }, 40);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!active) return;
    const dismiss = (event: KeyboardEvent) => { if (event.key === "Escape") setActive(null); };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [active]);

  const value = useMemo(() => ({ show, hide }), [show, hide]);
  return <GlossContext.Provider value={value}>{children}<GlossLayer active={active} /></GlossContext.Provider>;
}

function GlossLayer({ active }: { active: Active | null }) {
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    if (!active) { gsap.killTweensOf(node); gsap.set(node, { autoAlpha: 0 }); return; }
    const width = Math.min(300, window.innerWidth - 32);
    // Beside the object, flipping to whichever side has room.
    const right = active.rect.right + 14;
    const left = right + width > window.innerWidth - 12 ? Math.max(12, active.rect.left - width - 14) : right;
    const top = Math.min(Math.max(12, active.rect.top), window.innerHeight - node.offsetHeight - 12);
    const from = left < active.rect.left ? 8 : -8;
    gsap.killTweensOf(node);
    if (prefersReducedMotion()) { gsap.set(node, { autoAlpha: 1, left, top, x: 0 }); return; }
    gsap.set(node, { left, top });
    gsap.fromTo(node, { autoAlpha: 0, x: from }, { autoAlpha: 1, x: 0, duration: .12, ease: "power2.out" });
  }, [active]);

  return (
    <div ref={surface} id={GLOSS_ID} className="gloss" role="status" aria-live="polite">
      {active && <>
        {active.content.title && <p className="gloss-title">{active.content.title}</p>}
        <dl>{active.content.lines.map(line => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl>
      </>}
    </div>
  );
}

/**
 * Binds any element to the reveal. Focus behaves exactly like hover, so the
 * interface is navigable without a pointer, and the surface is a live region
 * so a screen reader hears what a sighted person sees.
 */
export function useGloss() {
  const context = useContext(GlossContext);
  return useCallback((content: GlossContent | null) => {
    if (!context || !content) return {};
    return {
      "aria-describedby": GLOSS_ID,
      onPointerEnter: (event: { currentTarget: Element }) => context.show(content, event.currentTarget),
      onPointerLeave: () => context.hide(),
      onFocus: (event: { currentTarget: Element }) => context.show(content, event.currentTarget),
      onBlur: () => context.hide(),
    };
  }, [context]);
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** How close something sits to what the person believes, in words. */
export function relationWords(fit: number): string {
  return fit >= .6 ? "Close to the centre of your thesis" : fit >= .35 ? "Connected to what you believe"
    : fit >= .15 ? "Loosely connected" : "You set this aside";
}

/**
 * Everything revealed about an asset, derived from what is already recorded.
 * Nothing is invented: with no real connection it says there is none.
 */
export function assetGloss(asset: Asset, state: HubState): GlossContent {
  const beliefs = convictionsOf(state);
  const belief = beliefs.find(c => asset.themes.some(t => c.themes.includes(t)));
  const confidence = Math.max(0, ...state.inferred.filter(i => asset.themes.includes(i.id)).map(i => i.confidence));
  const fit = relevance(asset, beliefs, state);
  const trade = state.trades.filter(t => t.asset.symbol === asset.symbol).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const seen = state.events.filter(e => `${e.text} ${e.detail ?? ""}`.includes(asset.symbol)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const lines: GlossLine[] = [
    { label: "Your belief", value: belief?.text ?? "Outside your thesis so far" },
    { label: "Relationship", value: relationWords(fit) },
  ];
  if (confidence > 0) lines.push({ label: "Agent confidence", value: percent(confidence) });
  if (trade) lines.push({ label: "You acted", value: `${trade.side === "buy" ? "Bought" : "Sold"} on ${new Date(trade.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` });
  else if (seen) lines.push({ label: "Last noted", value: new Date(seen.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) });
  return { title: asset.symbol, lines };
}

/** Why the agent said a thing: the belief its words touch, and how sure it is. */
export function messageGloss(text: string, state: HubState): GlossContent | null {
  const beliefs = convictionsOf(state);
  const themes: string[] = THEMES.filter(t => t.keywords.test(text)).map(t => t.id);
  const belief = beliefs.find(c => c.themes.some(t => themes.includes(t)));
  if (!belief) return null;
  const learned = state.inferred.find(i => belief.themes.includes(i.id));
  const lines: GlossLine[] = [
    { label: "Behind this", value: belief.text },
    { label: "Where it came from", value: belief.origin },
  ];
  if (learned) lines.push({ label: "Agent confidence", value: percent(learned.confidence) });
  return { title: "Why you are seeing this", lines };
}
