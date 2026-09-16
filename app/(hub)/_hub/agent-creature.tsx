"use client";

import { useId, useRef } from "react";
import { facePaths, gaze, type Expression, type FaceTraits } from "@/lib/socialtrading/face";
import type { IdentityPalette } from "@/lib/socialtrading/identity-palette";
import { gsap, useGSAP, prefersReducedMotion } from "../../_components/motion";

const HEX = "M100 13 175 56V143L100 187 25 143V56Z";
const INNER = "M100 24 165 62V137L100 175 35 137V62Z";

/** How open the eyes sit and how far the head tips, per state. Posture is as
 * much of the expression as the face is. */
const POSTURE: Record<Expression, { tilt: number; lift: number }> = {
  rest: { tilt: 0, lift: 0 },
  idle: { tilt: 0, lift: 0 },
  observing: { tilt: -4, lift: -1 },
  thinking: { tilt: 6, lift: 2 },
  discovering: { tilt: -8, lift: -4 },
  wanting: { tilt: -3, lift: -2 },
  interacting: { tilt: 0, lift: -1 },
};

/** Morphing needs real path geometry. Where the environment cannot measure a
 * path, the shape still changes, it just arrives without the tween. */
function morph(node: SVGPathElement | null, d: string, duration: number) {
  if (!node) return;
  if (duration === 0 || typeof node.getTotalLength !== "function") { node.setAttribute("d", d); return; }
  gsap.to(node, { morphSVG: d, duration, ease: "power2.inOut" });
}

/**
 * The agent, small enough to live in the margins. It is the profile badge's own
 * seeded face on the badge's own silhouette, so the thing crossing the screen
 * is visibly the same agent as the one on the identity card. Expressions morph
 * rather than cut, and the eyes follow whatever is being read without the body
 * having to go there.
 */
export function AgentCreature({ traits, palette, expression, lookAt, className }: {
  traits: FaceTraits;
  palette: IdentityPalette;
  expression: Expression;
  /** Viewport point the agent is attending to, and its own centre. */
  lookAt: { from: { x: number; y: number }; to: { x: number; y: number } | null };
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement>(null);
  const eyes = useRef<SVGPathElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const pupils = useRef<SVGGElement>(null);
  const head = useRef<SVGGElement>(null);
  const pose = useRef({ tilt: 0, lift: 0 });
  const look = useRef({ x: 0, y: 0 });
  const paths = facePaths(traits, expression);

  useGSAP(() => {
    const duration = prefersReducedMotion() ? 0 : .42;
    morph(eyes.current, paths.eyes, duration);
    morph(mouth.current, paths.mouth, duration);
    const posture = POSTURE[expression];
    // Posture is written straight onto the transform attribute: SVG groups are
    // not styled by the element transforms GSAP would otherwise reach for.
    gsap.to(pose.current, {
      ...posture, duration: duration * 1.6, ease: "power3.out",
      onUpdate: () => head.current?.setAttribute("transform", `rotate(${pose.current.tilt} 100 152) translate(0 ${pose.current.lift})`),
    });
  }, { dependencies: [expression], scope: root });

  useGSAP(() => {
    const offset = gaze(lookAt.from, lookAt.to);
    gsap.to(look.current, {
      ...offset, duration: prefersReducedMotion() ? 0 : .5, ease: "power2.out",
      onUpdate: () => pupils.current?.setAttribute("transform", `translate(${look.current.x} ${look.current.y})`),
    });
  }, { dependencies: [lookAt.to?.x, lookAt.to?.y, lookAt.from.x, lookAt.from.y], scope: root });

  return (
    <svg ref={root} viewBox="18 6 164 188" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-rim`} x1=".12" y1="0" x2=".85" y2="1">
          <stop stopColor={palette.soft} /><stop offset=".45" stopColor={palette.accent} /><stop offset="1" stopColor={palette.deep} />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#ffffff" /><stop offset=".3" stopColor={palette.soft} /><stop offset="1" stopColor={palette.accent} />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor={palette.accent} /><stop offset="1" stopColor={palette.deep} />
        </linearGradient>
      </defs>
      <g ref={head}>
        <path d={HEX} fill={`url(#${id}-rim)`} stroke="#fff" strokeOpacity=".55" strokeWidth="1.2" />
        <path d={INNER} fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity=".55" strokeWidth="1" />
        <path d={paths.head} fill={`url(#${id}-face)`} stroke={palette.soft} strokeWidth="1.6" />
        <g ref={pupils} fill="none" stroke="#fff" strokeLinecap="round">
          <path ref={eyes} d={paths.eyes} strokeWidth={traits.eyes === 3 ? 2.4 : 3.4} />
        </g>
        <path ref={mouth} d={paths.mouth} fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" />
      </g>
    </svg>
  );
}
