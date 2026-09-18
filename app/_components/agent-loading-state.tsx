"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AgentCreature } from "../(hub)/_hub/agent-creature";
import { gsap, useGSAP } from "./motion";
import { readLoadingAgent } from "./loading-agent-identity";
import { avatarTraits } from "@/lib/socialtrading/avatar";
import { identityPalette } from "@/lib/socialtrading/identity-palette";
import "./agent-loading-state.css";

export function AgentLoadingState({ label = "Loading…", userId, randomAgent = false }: { label?: string; userId?: string; randomAgent?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [identity, setIdentity] = useState(() => readLoadingAgent());
  useEffect(() => {
    if (randomAgent) {
      const seed = crypto.randomUUID();
      setIdentity({ traits: avatarTraits(seed), palette: identityPalette(seed, []) });
    } else setIdentity(readLoadingAgent(userId));
  }, [userId, randomAgent]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const body = root.current?.querySelector(".agent-loading-body");
      const shadow = root.current?.querySelector(".agent-loading-shadow");
      if (!body || !shadow) return;
      const route = [
        { x: -66, y: -18, scale: .76, rotation: -9, opacity: .72 },
        { x: 52, y: -38, scale: .88, rotation: 8, opacity: .85 },
        { x: 72, y: 16, scale: 1.18, rotation: -5, opacity: 1 },
        { x: -42, y: 24, scale: 1.08, rotation: 7, opacity: 1 },
        { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      ];
      const journey = gsap.timeline({ repeat: -1, defaults: { duration: 2.1, ease: "sine.inOut" } });
      route.forEach(point => {
        const start = journey.duration();
        journey.to(body, point, start).to(shadow, { x: point.x * .65, scaleX: point.scale, scaleY: point.scale, opacity: point.scale < 1 ? .12 : .24 }, start);
      });
      gsap.to(".agent-loading-signal", { opacity: .25, duration: 1, stagger: .18, repeat: -1, yoyo: true, ease: "sine.inOut" });
    });
    return () => media.revert();
  }, { scope: root });

  return <div ref={root} className="agent-loading" role="status" aria-live="polite" aria-label={label || "Loading"}
    style={{ "--loading-accent": identity.palette.accent, "--loading-wash": identity.palette.wash } as CSSProperties}>
    <div className="agent-loading-stage" aria-hidden="true">
      <span className="agent-loading-orbit" />
      <span className="agent-loading-orbit agent-loading-orbit-inner" />
      <span className="agent-loading-shadow" />
      <div className="agent-loading-body"><AgentCreature traits={identity.traits} palette={identity.palette} expression="rest" lookAt={{ from: { x: 0, y: 0 }, to: null }} className="agent-loading-creature" /></div>
    </div>
    {label && <p className="agent-loading-label">{label}</p>}
    <div className="agent-loading-signals" aria-hidden="true">{[0, 1, 2].map(i => <span key={i} className="agent-loading-signal" />)}</div>
  </div>;
}
