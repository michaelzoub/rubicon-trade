"use client";

import { useEffect, useId, useRef, useState } from "react";
import { newOnboarding, onboardingPreview } from "@/lib/socialtrading/onboarding";
import type { InvestingProfile } from "@/lib/socialtrading/profile";
import type { LearnedInterest } from "@/lib/socialtrading/types";
import { gsap, useGSAP, prefersReducedMotion, rubiconMotion } from "../_components/motion";
import { ProfileCard } from "./profile-card";

const PEEK = 72;

/** The live agent profile as a real card on the right edge. A sliver stays in
 * view; hover slides the rest out as an overlay. GSAP owns the idle peek and
 * the reveal. */
export function OnboardingAgentPeek({ profile, name, agentName, inferred = [] }: {
  profile: InvestingProfile; name?: string; agentName?: string; inferred?: LearnedInterest[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const slide = useRef<HTMLDivElement>(null);
  const idle = useRef<gsap.core.Tween | null>(null);
  const entered = useRef(false);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const preview = onboardingPreview(profile.investorAnswers.onboarding ?? newOnboarding());
  const live = { ...profile, thesis: preview.thesis, themes: preview.themes };
  const label = agentName ?? (name ? `${name}’s agent` : "Your agent");

  function hideX() {
    const el = slide.current;
    if (!el) return 0;
    return Math.max(0, el.offsetWidth - PEEK);
  }

  /** Peeked, the card sits in the slot. Drawn, it fans a few degrees toward you. */
  function pose(hidden: number, reduced: boolean) {
    return {
      x: hidden,
      rotationY: reduced ? 0 : 8,
      rotationZ: reduced ? 0 : 1.2,
      transformPerspective: 1200,
      transformOrigin: "100% 50%",
    };
  }

  function breathe(el: HTMLDivElement) {
    idle.current?.kill();
    idle.current = gsap.to(el, {
      x: hideX() - 10,
      duration: 2.1,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });
  }

  function change(value: boolean) {
    if (closing.current) { clearTimeout(closing.current); closing.current = null; }
    setOpen(value);
  }
  const leave = () => { closing.current = setTimeout(() => change(false), 140); };
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  useGSAP(() => {
    const el = slide.current;
    if (!el) return;
    idle.current?.kill();
    const hidden = hideX();
    const reduced = prefersReducedMotion();
    if (!entered.current) {
      entered.current = true;
      const park = () => {
        idle.current?.kill();
        gsap.set(el, pose(hideX(), reduced));
        if (!reduced) breathe(el);
      };
      park();
      const frame = requestAnimationFrame(park);
      return () => { cancelAnimationFrame(frame); idle.current?.kill(); };
    }
    if (open) {
      gsap.to(el, {
        x: 16,
        rotationY: reduced ? 0 : -6.5,
        rotationZ: reduced ? 0 : -2.6,
        duration: reduced ? 0 : .56,
        ease: rubiconMotion.ease.enter,
        overwrite: true,
      });
    } else {
      gsap.to(el, {
        ...pose(hidden, reduced),
        duration: reduced ? 0 : .48,
        ease: "power3.inOut",
        overwrite: true,
        onComplete: () => { if (!reduced && slide.current) breathe(slide.current); },
      });
    }
    return () => idle.current?.kill();
  }, { scope: root, dependencies: [open] });

  return <div ref={root} className={`onb-agent-peek${open ? " is-open" : ""}`}
    onPointerEnter={() => change(true)} onPointerLeave={leave}
    onMouseEnter={() => change(true)} onMouseLeave={leave}
    onFocus={() => change(true)}
    onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) change(false); }}
    onKeyDown={event => {
      if (event.key === "Escape" && open) change(false);
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); change(!open); }
    }}>
    <div ref={slide} className="onb-agent-slide" id={id} role="dialog" aria-label={label} tabIndex={0} aria-expanded={open}>
      <ProfileCard profile={live} name={name} agentName={agentName} inferred={inferred} identity={preview.portrait} compact />
    </div>
  </div>;
}
