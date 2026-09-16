"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { gsap, prefersReducedMotion } from "./motion";

/** The rubicon-app burst, ported to GSAP: fifteen pieces, the same paths, Rubicon blue in place of its brand blue. */
const PIECES = [
  [-150, -250, -38, "#2f80ed"], [-112, -292, 42, "#18181b"], [-72, -235, -76, "#62c79b"],
  [-36, -320, 88, "#f0b64d"], [0, -260, -28, "#2f80ed"], [34, -305, 64, "#e46d67"],
  [70, -242, -54, "#18181b"], [108, -286, 36, "#62c79b"], [148, -252, -82, "#f0b64d"],
  [-132, -190, 70, "#e46d67"], [-88, -214, -44, "#2f80ed"], [-48, -178, 92, "#62c79b"],
  [46, -196, -62, "#f0b64d"], [88, -218, 52, "#e46d67"], [130, -188, -96, "#2f80ed"],
] as const;

type Origin = { x: number; y: number } | Element | null | undefined;

/**
 * One rewarding moment. `celebrate(origin)` bursts confetti from an element or a
 * point; the burst removes itself when it ends. Reduced motion means no burst.
 */
export function useCelebration(): { celebrate: (origin?: Origin) => void; Celebration: ReactNode } {
  const [burst, setBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const celebrate = useCallback((origin?: Origin) => {
    if (prefersReducedMotion()) return;
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    if (origin instanceof Element) { const r = origin.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top + r.height / 2; }
    else if (origin) { x = origin.x; y = origin.y; }
    setBurst({ key: Date.now(), x, y });
  }, []);
  const done = useCallback(() => setBurst(null), []);
  return { celebrate, Celebration: burst ? <Burst key={burst.key} x={burst.x} y={burst.y} onDone={done} /> : null };
}

function Burst({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pieces = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-piece]") ?? []);
    const tl = gsap.timeline({ onComplete: onDone });
    pieces.forEach((piece, i) => {
      const [px, py, rot] = PIECES[i];
      tl.fromTo(piece, { opacity: 0, x: 0, y: 0, rotation: 0, scale: .92 }, {
        keyframes: [
          { opacity: 1, x: px * .45, y: py * .58, rotation: rot * .45, scale: 1, duration: .26 },
          { x: px, y: py, rotation: rot, scale: .96, duration: .26 },
          { opacity: 0, x: px * 1.08, y: py + 72, rotation: rot + 80, scale: .9, duration: .26 },
        ],
        ease: "power3.out",
      }, i * .018);
    });
    return () => { tl.kill(); };
  }, [onDone]);
  return createPortal(<div ref={root} className="rubicon-celebration" style={{ left: x, top: y }} aria-hidden="true">
    {PIECES.map(([, , , color], i) => <span key={i} data-piece style={{ background: color }} />)}
  </div>, document.body);
}
