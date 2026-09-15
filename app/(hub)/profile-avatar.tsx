"use client";

import { useId, useRef } from "react";
import { avatarTraits } from "@/lib/socialtrading/avatar";
import { badgePalette, type ThemeId } from "@/lib/socialtrading/themes";
import { gsap, useGSAP, rubiconMotion } from "../_components/motion";

const HEX = "M100 13 175 56V143L100 187 25 143V56Z";
const INNER = "M100 24 165 62V137L100 175 35 137V62Z";

/** A layered, softly bevelled badge. Account seed fixes the face; selected
 * themes blend the material palette without replacing the user's identity. */
export function ProfileAvatar({ seed, themes = [], inferred = [], className }: { seed: string; themes?: ThemeId[]; inferred?: ThemeId[]; className?: string }) {
  const traits = avatarTraits(seed);
  const palette = badgePalette(themes, traits.color, inferred);
  const previous = useRef(palette);
  const id = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement>(null);
  const material = `${palette.light}:${palette.color}:${palette.dark}`;

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-badge-layer]", { opacity: 0, y: 4 }, {
        opacity: 1, y: 0, duration: .4, stagger: .035,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [seed], revertOnUpdate: true });

  useGSAP(() => {
    const old = previous.current;
    previous.current = palette;
    if (old.light === palette.light && old.color === palette.color && old.dark === palette.dark) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      for (const key of ["light", "color", "dark"] as const) {
        gsap.fromTo(`[data-material="${key}"]`, { attr: { "stop-color": old[key] } }, {
          attr: { "stop-color": palette[key] }, duration: .5, ease: rubiconMotion.ease.state,
        });
      }
      gsap.fromTo(root.current, { scale: .975, y: 2 }, {
        scale: 1, y: 0, duration: .45, ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [material], revertOnUpdate: true });

  return (
    <svg ref={root} viewBox="0 0 200 208" className={`socialtrading-avatar${className ? ` ${className}` : ""}`} role="img" aria-label="Your personalized agent badge">
      <defs>
        <linearGradient id={`${id}-rim`} x1=".12" y1="0" x2=".85" y2="1">
          <stop data-material="light" stopColor={palette.light} />
          <stop offset=".35" data-material="color" stopColor={palette.color} />
          <stop offset="1" data-material="dark" stopColor={palette.dark} />
        </linearGradient>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#ffffff" /><stop offset=".28" data-material="light" stopColor={palette.light} />
          <stop offset="1" data-material="color" stopColor={palette.color} />
        </linearGradient>
        <linearGradient id={`${id}-face`} x1="0" y1="0" x2=".8" y2="1">
          <stop data-material="color" stopColor={palette.color} /><stop offset="1" data-material="dark" stopColor={palette.dark} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff" stopOpacity=".75" /><stop offset=".55" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        <clipPath id={`${id}-clip`}><path d={INNER} /></clipPath>
      </defs>
      <ellipse cx="100" cy="192" rx="51" ry="6" fill="#18181b" opacity=".12" filter={`url(#${id}-shadow)`} />
      <g data-badge-layer>
        <path d={HEX} transform="translate(0 5)" fill={`url(#${id}-face)`} />
        <path d={HEX} fill={`url(#${id}-rim)`} stroke="#fff" strokeOpacity=".6" strokeWidth=".8" />
        <path d="m25 56 10 6 65-38V13Z" fill="#fff" opacity=".3" />
        <path d="m165 62 10-6v87l-10-6Z" fill="#18181b" opacity=".1" />
        <path d={INNER} fill={`url(#${id}-body)`} stroke="#fff" strokeOpacity=".6" strokeWidth=".8" />
      </g>
      <g data-badge-layer clipPath={`url(#${id}-clip)`} stroke="#fff" strokeWidth=".7" opacity=".32" fill="none">
        {traits.pattern === 0 && [0, 1, 2, 3, 4].map(i => <path key={i} d={`M${35 + i * 24} 28v144`} />)}
        {traits.pattern === 1 && [0, 1, 2, 3].map(i => <path key={i} d={`M20 ${40 + i * 29} 180 ${118 + i * 29}`} />)}
        {traits.pattern === 2 && [38, 54, 70, 86].map(r => <circle key={r} cx="100" cy="102" r={r} />)}
        {traits.pattern === 3 && <path d="M40 68h22v70h22V49h32v110h22V84h24" />}
      </g>
      <g data-badge-layer>
        <path d="M67 140q2-26 33-26t33 26v7H67Z" fill={`url(#${id}-face)`} opacity=".6" />
        {traits.face % 3 === 0 ? <rect x="76" y="62" width="48" height="65" rx="23" fill={`url(#${id}-face)`} /> : traits.face % 3 === 1 ? <path d="M77 70q23-23 46 0v35q0 23-23 23t-23-23Z" fill={`url(#${id}-face)`} /> : <rect x="76" y="63" width="48" height="64" rx="16" fill={`url(#${id}-face)`} />}
        <path d="M79 85v-6q0-14 17-14" stroke="#fff" strokeOpacity=".38" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <g fill="none" stroke="#fff" strokeOpacity=".72" strokeWidth="1.8" strokeLinecap="round">
          {traits.eyes % 3 === 0 ? <path d="M89 93v3m22-3v3" /> : traits.eyes % 3 === 1 ? <path d="M86 95h5m18 0h5" /> : <path d="m86 95 3-2 3 2m16 0 3-2 3 2" />}
          <path d={traits.mouth % 2 ? "M97 109h6" : "M96 108q4 3 8 0"} strokeOpacity=".5" />
        </g>
      </g>
      <g data-badge-layer fill="none" stroke="#fff" strokeOpacity=".65" strokeWidth="1">
        <path d="m100 31 59 34v68l-59 35-59-35V65Z" />
        <path d="M92 153h16" strokeWidth="2" strokeLinecap="round" />
        {traits.accessory % 2 === 0 ? <path d="m145 76 4-7 4 7-4 7Z" /> : <circle cx="149" cy="76" r="4" />}
      </g>
      <path d={INNER} fill={`url(#${id}-shine)`} pointerEvents="none" />
    </svg>
  );
}
