"use client";

import { useEffect, useRef, type ComponentType, type CSSProperties, type KeyboardEvent } from "react";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";

export type LensItem<T extends string> = {
  id: T; label: string;
  /** Optional: a lens reads better with a mark, but a range ("30D") does not. */
  icon?: ComponentType<{ size?: number | string; strokeWidth?: number | string; "aria-hidden"?: boolean }>;
  /** Each lens has its own colour, so the light changes character as it travels. */
  hue: string;
};

/**
 * A segmented control for exploring, not filtering. One light stretches toward
 * the chosen lens and settles there, in the same two-beat move as the tab bar.
 */
export function Lens<T extends string>({ items, value, onChange, label, className = "" }: {
  items: readonly LensItem<T>[]; value: T; onChange: (id: T) => void; label: string; className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);
  const active = items.find(i => i.id === value) ?? items[0];

  const place = (animate: boolean) => {
    const node = light.current, target = bar.current?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!node || !target) return;
    const to = { x: target.offsetLeft, width: target.offsetWidth };
    if (!animate) { gsap.set(node, { ...to, opacity: 1 }); return; }
    const from = { x: gsap.getProperty(node, "x") as number, width: gsap.getProperty(node, "width") as number };
    const left = Math.min(from.x, to.x), right = Math.max(from.x + from.width, to.x + to.width);
    gsap.timeline({ overwrite: true })
      .to(node, { x: left, width: right - left, duration: .2, ease: "power2.in" })
      .to(node, { x: to.x, width: to.width, duration: .4, ease: rubiconMotion.ease.enter });
  };

  useGSAP(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    place(settled.current && !reduced);
    settled.current = true;
  }, { dependencies: [value] });

  useEffect(() => {
    const align = () => place(false);
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = items.findIndex(i => i.id === value);
    const next = event.key === "ArrowRight" ? items[(index + 1) % items.length] : event.key === "ArrowLeft" ? items[(index - 1 + items.length) % items.length] : event.key === "Home" ? items[0] : event.key === "End" ? items[items.length - 1] : null;
    if (!next) return;
    event.preventDefault(); onChange(next.id);
    bar.current?.querySelector<HTMLElement>(`[data-lens="${next.id}"]`)?.focus();
  };

  return <div ref={bar} className={`hub-lens ${className}`} role="tablist" aria-label={label} style={{ "--lens-hue": active.hue } as CSSProperties}>
    {items.map((item, index) => {
      const selected = item.id === value;
      // The index rides along so the unchosen lenses can take turns inviting a press.
      return <button key={item.id} type="button" role="tab" data-lens={item.id} aria-selected={selected} tabIndex={selected ? 0 : -1}
        className={`hub-lens-item${selected ? " is-active" : ""}`} style={{ "--lens-hue": item.hue, "--lens-index": index } as CSSProperties}
        onPointerMove={event => { if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--mx", `${(event.clientX - rect.left) / rect.width * 100}%`); event.currentTarget.style.setProperty("--my", `${(event.clientY - rect.top) / rect.height * 100}%`); }}
        onClick={() => onChange(item.id)} onKeyDown={key}>
        {item.icon && <item.icon size={14} strokeWidth={1.8} aria-hidden />}
        <span>{item.label}</span>
      </button>;
    })}
    <span ref={light} className="hub-lens-light" aria-hidden="true" />
  </div>;
}
