"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";

gsap.registerPlugin(useGSAP);

/**
 * Rubicon's motion language, shared with the marketing site. Timings are
 * deliberately few and none of the curves overshoot.
 */
export const rubiconMotion = {
  duration: { micro: 0.18, state: 0.28, exit: 0.2, section: 0.82, hero: 0.86 },
  ease: { enter: "power4.out", state: "power2.inOut", exit: "power2.in" },
  stagger: { line: 0.08, item: 0.045 },
} as const;

export { gsap, useGSAP };
