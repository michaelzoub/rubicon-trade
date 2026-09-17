"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Plus } from "lucide-react";
import { gsap, useGSAP, prefersReducedMotion } from "../../_components/motion";
import { HubLink } from "./navigation";

/** Home, Explore and Memory live in the header; account destinations live in the avatar. */
export function CommandMenu({ resolveHref }: { resolveHref: (href: string) => string }) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  const close = () => { cancel(); pinned.current = false; setOpen(false); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) close(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { close(); if (root.current?.contains(document.activeElement)) trigger.current?.focus(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(value => !value); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    return () => { cancel(); document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, []);
  useGSAP(() => {
    if (!open || prefersReducedMotion()) return;
    gsap.fromTo(".rubicon-portals", { opacity: 0, y: -8, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .3, ease: "power3.out", clearProps: "all" });
    gsap.fromTo(".rubicon-portal", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .4, stagger: .055, clearProps: "all" });
  }, { scope: root, dependencies: [open], revertOnUpdate: true });
  return <div ref={root} className="rubicon-more" onPointerEnter={event => { cancel(); if (event.pointerType === "mouse") setOpen(true); }} onPointerLeave={() => { cancel(); timer.current = setTimeout(() => { if (!pinned.current && !root.current?.contains(document.activeElement)) close(); }, 180); }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <button ref={trigger} type="button" className="rubicon-more-trigger" aria-label="Discover more of Rubicon" aria-expanded={open} aria-controls="rubicon-destinations" aria-keyshortcuts="Meta+k Control+k" onClick={() => { cancel(); if (pinned.current) close(); else { pinned.current = true; setOpen(true); } }}><Plus size={19} /></button>
    {open && <nav id="rubicon-destinations" className="rubicon-portals" aria-label="More of Rubicon">
      <HubLink href={resolveHref("/thesis")} className="rubicon-portal is-thesis" onClick={close}>
        <span className="portal-heading"><strong>Your thesis</strong><ArrowUpRight size={15}/></span><span className="portal-note">What you believe.</span>
        <span className="portal-strata" aria-hidden="true"><i/><i/><i/><i/></span>
      </HubLink>
      <HubLink href={resolveHref("/agents")} className="rubicon-portal is-agents" onClick={close}>
        <span className="portal-heading"><strong>Your agents</strong><ArrowUpRight size={15}/></span><span className="portal-note">A mind beside yours.</span>
        <span className="portal-orbit" aria-hidden="true"><i/><i/><i/></span>
      </HubLink>
    </nav>}
  </div>;
}
