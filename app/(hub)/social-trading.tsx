"use client";
import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { SiteHeader } from "../_components/site-header";
import { SignInScene } from "../_components/sign-in";
import { LoadingState } from "../_components/ui";
import { usePrivyConfigured } from "../providers";
import { ProfileFlow } from "./onboarding-flow";
export { ProfileFlow } from "./onboarding-flow";
import "./socialtrading.css";

function Frame({ children, onboarding = false }: { children: ReactNode; onboarding?: boolean }) {
  return <div className={`landing-page socialtrading-page${onboarding ? " is-onboarding" : ""}`}><SiteHeader /><main className="container socialtrading-main"><div className="dashboard-theme socialtrading-flow">{children}</div></main></div>;
}

export function SocialTrading() {
  const configured = usePrivyConfigured();
  if (!configured) return <Frame><h1 className="landing-section-title">Sign-in is unavailable</h1><p className="mt-3 text-sm text-[var(--muted)]">Rubicon sign-in needs to be configured before you can create an investing profile.</p></Frame>;
  return <AuthenticatedProfile />;
}

function AuthenticatedProfile() {
  const { ready, authenticated, user } = usePrivy();
  if (!ready) return <Frame><LoadingState label="Loading your session…" /></Frame>;
  if (!authenticated || !user) return <div className="landing-page socialtrading-page"><SignInScene /></div>;
  // Unmount local state immediately on logout/account switch, as in AppProviders.
  return <Frame onboarding><ProfileFlow key={user.id} userId={user.id} name={user.twitter?.name ?? user.email?.address?.split("@")[0]} /></Frame>;
}
