"use client";

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

/** One portal keeps hints clear of scrolling panels and clipped cards. */
export function HoverTooltips() {
  const id = useId();
  const [tip, setTip] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);
  useEffect(() => {
    let target: HTMLElement | null = null;
    let previousDescription: string | null = null;
    const hide = () => {
      if (target) {
        if (previousDescription) target.setAttribute("aria-describedby", previousDescription);
        else target.removeAttribute("aria-describedby");
      }
      target = null; setTip(null);
    };
    const show = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tooltip]") : null;
      if (element === target) return;
      hide();
      const text = element?.dataset.tooltip;
      if (!element || !text) return;
      target = element; previousDescription = element.getAttribute("aria-describedby");
      element.setAttribute("aria-describedby", [previousDescription, id].filter(Boolean).join(" "));
      const rect = element.getBoundingClientRect();
      const width = Math.min(280, window.innerWidth - 24);
      const above = rect.bottom + 140 > window.innerHeight;
      setTip({ text, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)), top: above ? rect.top - 8 : rect.bottom + 8, above });
    };
    const leave = (event: MouseEvent | FocusEvent) => {
      if (target && event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
      hide();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("mouseout", leave);
    document.addEventListener("focusout", leave);
    document.addEventListener("keydown", key);
    document.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      hide();
      document.removeEventListener("mouseover", show); document.removeEventListener("focusin", show);
      document.removeEventListener("mouseout", leave); document.removeEventListener("focusout", leave);
      document.removeEventListener("keydown", key); document.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [id]);
  return tip ? createPortal(<div id={id} role="tooltip" className="rubicon-hover-surface rubicon-tooltip" style={{ left: tip.left, top: tip.top, transform: tip.above ? "translateY(-100%)" : undefined }}>{tip.text}</div>, document.body) : null;
}
