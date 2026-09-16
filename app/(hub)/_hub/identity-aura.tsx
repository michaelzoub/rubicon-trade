"use client";

import { useId, useMemo, useRef } from "react";
import { auraLobes, type AuraLobe } from "@/lib/socialtrading/identity";
import type { ThemeId } from "@/lib/socialtrading/themes";
import type { HubState } from "@/lib/socialtrading/types";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";

const BOX = 320, CENTRE = BOX / 2, RING = 126;
const CIRCUMFERENCE = 2 * Math.PI * RING;

/**
 * A person's aura: one soft lobe per theme they hold, placed by a hash of their
 * own id so no two compositions sit the same way. The ring is the progression
 * — the identity and the progress are one object rather than a picture next to
 * a bar, which is why this page needs no meter anywhere else.
 *
 * Every value is derived and seeded, so the server and the browser draw the
 * same aura and it never flickers on hydration.
 */
export function IdentityAura({ seed, themes, inferred = [], progress, depth, energy = 0, label, className }: {
  seed: string; themes: readonly ThemeId[]; inferred?: HubState["inferred"];
  /** 0–1 through the current stage. Draws the ring. */
  progress: number;
  /** Learning depth. A denser core means the agents have more to go on. */
  depth: number;
  /** Events in the last week. The whole composition turns faster when things are happening. */
  energy?: number;
  label: string; className?: string;
}) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId().replace(/:/g, "");
  const lobes = useMemo(() => auraLobes(seed, themes, inferred), [seed, themes, inferred]);
  // The core is the settled middle of an identity: it tightens and brightens as
  // the agents gather more, but never grows past the lobes around it.
  const core = 20 + Math.min(28, depth / 7);

  // The aura blooms once and then just lives. Progress is deliberately NOT a
  // dependency here: the count of agents arrives a moment after the first paint,
  // and re-running this would make the whole composition bloom a second time.
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-aura-field]", { scale: .84, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.1, ease: rubiconMotion.ease.enter, svgOrigin: `${CENTRE} ${CENTRE}` });

      // Each lobe breathes on its own clock, so the aura never pulses as a unit.
      for (const [index, lobe] of lobes.entries()) {
        const node = root.current?.querySelector(`[data-lobe="${index}"]`);
        if (!node) continue;
        const away = index % 2 === 0 ? 1 : -1;
        gsap.to(node, { x: lobe.travel * away, y: lobe.travel * -away * .7, scale: 1.07, duration: lobe.drift, delay: lobe.delay, repeat: -1, yoyo: true, ease: "sine.inOut", svgOrigin: `${lobe.x} ${lobe.y}` });
      }
      // One slow turn over everything. A busy week spins it closer to 70s, a quiet one nearer 140s.
      gsap.to("[data-aura-field]", { rotation: 360, duration: Math.max(70, 140 - energy * 6), repeat: -1, ease: "none", svgOrigin: `${CENTRE} ${CENTRE}` });
      gsap.to("[data-aura-core]", { opacity: .85, scale: 1.06, duration: 7, repeat: -1, yoyo: true, ease: "sine.inOut", svgOrigin: `${CENTRE} ${CENTRE}` });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [seed, lobes, energy], revertOnUpdate: true });

  // The ring draws itself on arrival, then travels to wherever progress lands
  // next. Growing by a few percent should feel like the ring easing forward,
  // not like the page reloading.
  const drawn = useRef(false);
  useGSAP(() => {
    const target = CIRCUMFERENCE * (1 - progress);
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const first = !drawn.current;
      drawn.current = true;
      gsap.fromTo("[data-aura-arc]", { strokeDashoffset: first ? CIRCUMFERENCE : undefined },
        { strokeDashoffset: target, duration: first ? 1.5 : .8, delay: first ? .35 : 0, ease: "power3.inOut" });
      gsap.fromTo("[data-aura-bead]", { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, duration: .5, delay: first ? 1.5 : 0, ease: rubiconMotion.ease.enter, svgOrigin: `${CENTRE} ${CENTRE}` });
    });
    media.add("(prefers-reduced-motion: reduce)", () => { gsap.set("[data-aura-arc]", { strokeDashoffset: target }); });
    return () => media.revert();
  }, { scope: root, dependencies: [progress] });

  const tip = -Math.PI / 2 + progress * Math.PI * 2;

  return (
    <svg ref={root} viewBox={`0 0 ${BOX} ${BOX}`} className={`hub-aura${className ? ` ${className}` : ""}`} role="img" aria-label={label}>
      <defs>
        {lobes.map((lobe, index) => <radialGradient key={lobe.id} id={`${id}-lobe-${index}`}>
          <stop offset="0" stopColor={lobe.glow} stopOpacity="1" />
          <stop offset=".22" stopColor={lobe.deep} stopOpacity={.62 + lobe.weight * .3} />
          <stop offset=".62" stopColor={lobe.deep} stopOpacity={.3 + lobe.weight * .22} />
          <stop offset="1" stopColor={lobe.deep} stopOpacity="0" />
        </radialGradient>)}
        <radialGradient id={`${id}-core`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".72" />
          <stop offset=".55" stopColor="#fff" stopOpacity=".3" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-soften`} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>

      <g data-aura-field filter={`url(#${id}-soften)`}>
        {lobes.map((lobe, index) => <Lobe key={lobe.id} lobe={lobe} index={index} fill={`url(#${id}-lobe-${index})`} />)}
        <circle data-aura-core cx={CENTRE} cy={CENTRE} r={core} fill={`url(#${id}-core)`} opacity=".55" />
      </g>

      {/* The ring reads as the edge of the aura, so progress never looks like a meter bolted on. */}
      <g fill="none" strokeLinecap="round">
        <circle cx={CENTRE} cy={CENTRE} r={RING} stroke={lobes[0]?.deep ?? "#98a7d9"} strokeOpacity=".2" strokeWidth="1" />
        <circle data-aura-arc cx={CENTRE} cy={CENTRE} r={RING} stroke={lobes[0]?.deep ?? "#98a7d9"} strokeOpacity=".85" strokeWidth="2.5"
          strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE * (1 - progress)} transform={`rotate(-90 ${CENTRE} ${CENTRE})`} />
        {progress > 0 && progress < 1 && <circle data-aura-bead cx={CENTRE + Math.cos(tip) * RING} cy={CENTRE + Math.sin(tip) * RING} r="4"
          fill={lobes[0]?.deep ?? "#98a7d9"} stroke="#fff" strokeWidth="2" />}
      </g>
    </svg>
  );
}

function Lobe({ lobe, index, fill }: { lobe: AuraLobe; index: number; fill: string }) {
  return <circle data-lobe={index} cx={lobe.x} cy={lobe.y} r={lobe.radius} fill={fill} />;
}
