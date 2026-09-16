"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Clock, Compass, MessageCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { PurchaseDialog } from "./purchase-dialog";
import { CommandMenu } from "./command-menu";
import "./refinements.css";
import { AccountMenu } from "./account-menu";
import { HoverTooltips } from "../../_components/hover-tooltips";
import { planName } from "./limits-ui";
import { SiteHeader } from "../../_components/site-header";
import { SignInScene } from "../../_components/sign-in";
import { LoadingState } from "../../_components/ui";
import { usePrivyConfigured } from "../../providers";
import { profileKey, readProfile, type InvestingProfile } from "@/lib/socialtrading/profile";
import { agentSelectionKey } from "@/lib/socialtrading/agents/config";
import type { HubState } from "@/lib/socialtrading/types";
import { gsap, useGSAP, rubiconMotion } from "../../_components/motion";
import { ProfileFlow } from "../social-trading";
import { AmbientAgent } from "./ambient-agent";
import { GlossProvider } from "./gloss";
import { identityPalette, identityVars } from "@/lib/socialtrading/identity-palette";
import { hubApi, HubRequestError } from "./client";
import { useAccountSummary } from "./account-state";
import { HubProvider, useHub } from "./hub-provider";
import { identityDepth, identityStage, identityStats } from "@/lib/socialtrading/identity";
import "../socialtrading.css";
import "./hub.css";
import "./hub-consumer.css";
import "./quiet-refinement.css";

export const NAV = [
  { href: "/", label: "Home", icon: MessageCircle, exact: true },
  { href: "/explore", label: "Explore", icon: Compass, exact: false },
  { href: "/activity", label: "Memory", icon: Clock, exact: true },
] as const;

function Frame({ children, wide = false, accountStatus, nav }: { children: ReactNode; wide?: boolean; accountStatus?: ReactNode; nav?: ReactNode }) {
  return <div className="landing-page socialtrading-page"><HoverTooltips /><SiteHeader accountStatus={accountStatus} session={!accountStatus} nav={nav} /><main className={`container socialtrading-main${wide ? " is-hub" : ""}`}><div className="dashboard-theme socialtrading-flow">{children}</div></main></div>;
}

export function HubShell({ children }: { children: ReactNode }) {
  const configured = usePrivyConfigured();
  if (!configured) return <Frame><h1 className="landing-section-title">Sign-in is unavailable</h1><p className="mt-3 text-sm text-[var(--muted)]">Rubicon sign-in needs to be configured before you can create an investing profile.</p></Frame>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: ReactNode }) {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <Frame><LoadingState label="Loading your session…" /></Frame>;
  if (!authenticated || !user) return <div className="landing-page socialtrading-page"><SignInScene /></div>;
  return <Boot key={user.id} userId={user.id} name={user.twitter?.name ?? user.email?.address?.split("@")[0]}>{children}</Boot>;
}

/** Loads the private workspace. Without one, onboarding runs and its result
 * seeds the server; the hub only appears once the server has the profile. */
function Boot({ userId, name, children }: { userId: string; name?: string; children: ReactNode }) {
  const { getAccessToken } = usePrivy();
  const [state, setState] = useState<HubState | null | undefined>(undefined);
  const [account, setAccount] = useAccountSummary(userId);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const token = () => getAccessToken();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const selected = (() => { try { return localStorage.getItem(agentSelectionKey(userId)) ?? "default"; } catch { return "default"; } })();
        const first = await hubApi.load(token, selected);
        let loaded = first.state;
        if (first.account) setAccount(first.account);
        if (!loaded && selected !== "default") loaded = (await hubApi.load(token)).state;
        // The remembered agent (or the default) may have been deleted; land on whichever agent still exists.
        if (!loaded) { const first = (await hubApi.agents(token).catch(() => ({ agents: [] }))).agents[0]; if (first) loaded = (await hubApi.load(token, first.id)).state; }
        if (cancelled) return;
        if (loaded) { setState(loaded); return; }
        // A profile completed in this browser before the hub existed seeds the workspace.
        let local: InvestingProfile | null = null;
        try { local = readProfile(localStorage.getItem(profileKey(userId)), userId); } catch { /* storage unavailable */ }
        if (local?.completedAt) { const created = await hubApi.post(token, 0, { action: "initialize", profile: local, userName: name }); if (!cancelled) { if (created.account) setAccount(created.account); setState(created.state); } }
        else setState(null);
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : "Your workspace could not be loaded."); setState(null); } }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function complete(profile: InvestingProfile) {
    setSaving(true); setError("");
    try { const created = await hubApi.post(token, 0, { action: "initialize", profile, userName: name }); if (created.account) setAccount(created.account); setState(created.state); }
    catch (e) { setError(e instanceof HubRequestError ? e.message : "Your profile could not be saved. Please try again."); }
    finally { setSaving(false); }
  }

  if (state === undefined) return <Frame><LoadingState label="Loading your profile…" /></Frame>;
  if (!state) return <Frame><ProfileFlow userId={userId} name={name} onComplete={complete} completing={saving} serverError={error} /></Frame>;
  return <HubProvider userId={userId} name={name} initial={state} initialAccount={account}><Hub>{children}</Hub></HubProvider>;
}

const index = (pathname: string) => NAV.findIndex(item => item.exact ? pathname === item.href : pathname.startsWith(item.href));

/** Top tab bar. The active mark stretches toward the destination before it
 * settles, so the eye follows the move rather than watching a jump cut. */
function TabBar({ pathname, onNavigate, resolveHref }: { pathname: string; onNavigate: (event: MouseEvent<HTMLAnchorElement>, href: string) => void; resolveHref: (href: string) => string }) {
  const bar = useRef<HTMLElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const settled = useRef(false);

  useGSAP(() => {
    const active = bar.current?.querySelector<HTMLElement>(".hub-nav-link.is-active");
    const node = mark.current;
    if (!node) return;
    if (!active) { gsap.set(node, { opacity: 0 }); return; }
    const to = { x: active.offsetLeft, width: active.offsetWidth };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!settled.current || reduced) { settled.current = true; gsap.set(node, { ...to, opacity: 1 }); return; }
    const from = { x: gsap.getProperty(node, "x") as number, width: gsap.getProperty(node, "width") as number };
    const left = Math.min(from.x, to.x), right = Math.max(from.x + from.width, to.x + to.width);
    gsap.timeline()
      .to(node, { x: left, width: right - left, duration: .22, ease: "power2.in" })
      .to(node, { x: to.x, width: to.width, duration: .34, ease: rubiconMotion.ease.enter });
  }, { dependencies: [pathname] });

  useEffect(() => {
    const align = () => {
      const active = bar.current?.querySelector<HTMLElement>(".hub-nav-link.is-active");
      if (active && mark.current) gsap.set(mark.current, { x: active.offsetLeft, width: active.offsetWidth });
    };
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, []);

  return (
    <nav ref={bar} className="hub-nav" aria-label="Social trading">
      {NAV.map(item => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return <Link key={item.href} href={resolveHref(item.href)} className={`hub-nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={e => onNavigate(e, item.href)}>
          <span>{item.label}</span>
        </Link>;
      })}
      <span ref={mark} className="hub-nav-mark" aria-hidden="true" />
    </nav>
  );
}

export function Hub({ children, path, resolveHref = href => href }: {
  children: ReactNode;
  /** Preview seam: the hub route to treat as current, and how tab hrefs map onto the preview. */
  path?: string; resolveHref?: (href: string) => string;
}) {
  const routePath = usePathname();
  const pathname = path ?? routePath;
  const router = useRouter();
  const { state, name, userId, error, clearError, account, agents } = useHub();
  const identityStats_ = identityStats(state, agents.length ? agents : state.agent ? [state.agent] : []);
  const depth = identityDepth(state, identityStats_);
  const identityStage_ = identityStage(depth);
  // The whole product wears one accent, derived from what the person believes
  // and how much the agent has learned. Set once, read everywhere.
  const palette = useMemo(() => identityPalette(userId, state.profile.themes, state.inferred, depth), [userId, state.profile.themes, state.inferred, depth]);
  const stage = useRef<HTMLDivElement>(null);
  const previousPath = useRef(pathname);
  const direction = useRef(1);
  const leaving = useRef<string | null>(null);

  // Entering: the new view arrives from the side the user moved toward.
  useGSAP(() => {
    if (previousPath.current === pathname || !stage.current) { previousPath.current = pathname; return; }
    const dir = Math.sign(index(pathname) - index(previousPath.current)) || direction.current;
    previousPath.current = pathname; leaving.current = null;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const parts = stage.current!.querySelectorAll(":scope > :not(.hub-error) > *");
      gsap.timeline({ defaults: { ease: rubiconMotion.ease.enter } })
        .fromTo(stage.current, { opacity: 0, x: dir * 22, filter: "blur(6px)" }, { opacity: 1, x: 0, filter: "blur(0px)", duration: .46, clearProps: "all" })
        .fromTo(parts, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: .5, stagger: .05, clearProps: "all" }, .05);
    });
    return () => media.revert();
  }, { dependencies: [pathname] });

  // Leaving: a short exit before the route changes, in the direction of travel.
  const { contextSafe } = useGSAP({ scope: stage });
  const navigate = contextSafe((event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (href === pathname || leaving.current === href) return;
    event.preventDefault();
    const dir = Math.sign(index(href) - index(pathname)) || 1;
    direction.current = dir;
    const target = resolveHref(href);
    if (!stage.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { router.push(target); return; }
    leaving.current = href;
    gsap.killTweensOf(stage.current);
    gsap.to(stage.current, { opacity: 0, x: -dir * 14, filter: "blur(3px)", duration: .16, ease: rubiconMotion.ease.exit, onComplete: () => router.push(target) });
  });

  return (
    <Frame wide
      nav={<div className="rubicon-navigation"><TabBar pathname={pathname} onNavigate={navigate} resolveHref={resolveHref} /><CommandMenu resolveHref={resolveHref}/></div>}
      accountStatus={<AccountMenu userId={userId} name={name} planName={planName(account)} account={account}
        themes={state.profile.themes} inferred={state.inferred}
        identity={{ progress: identityStage_.progress, depth: identityStage_.depth, energy: identityStats_.energy }}
        profileHref={resolveHref("/profile")} plansHref={resolveHref("/plans")} preview={path !== undefined} />}>
      <GlossProvider>
        <AmbientAgent resolveHref={resolveHref} />
        <PurchaseDialog />
        <div className="hub-layout" style={identityVars(palette) as CSSProperties}>
          <div ref={stage} className="hub-stage">
            {error && <p className="hub-error" role="alert">{error} <button type="button" onClick={clearError}>Dismiss</button></p>}
            <div key={state.agent?.id ?? "default"}>{children}</div>
          </div>
        </div>
      </GlossProvider>
    </Frame>
  );
}
