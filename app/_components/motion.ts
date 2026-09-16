"use client";

import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Flip } from "gsap/Flip";
import { Draggable } from "gsap/Draggable";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { CustomEase } from "gsap/CustomEase";
import { Observer } from "gsap/Observer";

gsap.registerPlugin(useGSAP, ScrollTrigger, Flip, Draggable, InertiaPlugin, MorphSVGPlugin, CustomEase, Observer);

/** Curves the ambient agent moves by. `creature` leaves rest reluctantly and
 * settles without overshoot, the way something alive arrives somewhere;
 * `breath` rises faster than it falls, so the idle loop never reads as a sine. */
if (!CustomEase.get("creature")) CustomEase.create("creature", "M0,0 C0.18,0 0.24,0.08 0.38,0.42 0.52,0.76 0.66,1 1,1");
if (!CustomEase.get("breath")) CustomEase.create("breath", "M0,0 C0.26,0.42 0.34,1 0.5,1 0.66,1 0.76,0.4 1,0");

/**
 * Rubicon's motion language, shared with the marketing site. Timings are
 * deliberately few and none of the curves overshoot.
 */
export const rubiconMotion = {
  duration: { micro: 0.18, state: 0.28, exit: 0.2, section: 0.82, hero: 0.86 },
  ease: { enter: "power4.out", state: "power2.inOut", exit: "power2.in", creature: "creature", breath: "breath" },
  stagger: { line: 0.08, item: 0.045 },
} as const;

/** True when the visitor asked for less motion. Safe on the server. */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export { gsap, useGSAP, ScrollTrigger, Flip, Draggable, InertiaPlugin, MorphSVGPlugin, CustomEase, Observer };
