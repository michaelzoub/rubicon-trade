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
      <HubLink href={resolveHref("/beliefs")} className="rubicon-portal is-thesis" onClick={close}>
        <span className="portal-heading"><strong>Your beliefs</strong><ArrowUpRight size={15}/></span><span className="portal-note">The thinking behind your holdings.</span>
        <svg className="portal-beliefs" viewBox="0 0 240 100" aria-hidden="true"><path d="M0 92 L35 85 L70 88 L105 61 L140 68 L175 38 L210 45 L240 24 L240 100 L0 100Z" fill="#729fdd" opacity=".25"/><path d="M0 92 L35 85 L70 88 L105 61 L140 68 L175 38 L210 45 L240 24" fill="none" stroke="#8ab3eb" strokeWidth="2"/><path d="M0 98 L35 93 L70 94 L105 79 L140 84 L175 65 L210 72 L240 57 L240 100 L0 100Z" fill="#8ab3eb" opacity=".4"/><g fill="#c4dbfa"><circle cx="105" cy="61" r="4"/><circle cx="175" cy="38" r="4"/><circle cx="240" cy="24" r="4"/></g></svg>
      </HubLink>
      <HubLink href={resolveHref("/agents")} className="rubicon-portal is-agents" onClick={close}>
        <span className="portal-heading"><strong>Your agents</strong><ArrowUpRight size={15}/></span><span className="portal-note">A mind beside yours.</span>
        <span className="portal-orbit" aria-hidden="true"><i/><i/><i/></span>
      </HubLink>
    </nav>}
  </div>;
}
