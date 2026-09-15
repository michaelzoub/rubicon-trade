"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePrivyConfigured } from "../providers";
import { RubiconBrand } from "./rubicon-brand";

export function SiteHeader({ accountStatus }: { accountStatus?: ReactNode }) {
  const configured = usePrivyConfigured();
  return (
    <header className="site-header">
      <nav className="container site-header-inner" aria-label="Main navigation">
        <Link href="/" className="site-header-logo" aria-label="Rubicon home">
          <RubiconBrand className="site-header-brand site-header-brand--new" src="/Header-logo_w.svg" />
        </Link>
        <div className="site-header-links" />
        <div className="site-header-actions">{accountStatus}{configured && <Session />}</div>
      </nav>
    </header>
  );
}

function Session() {
  const { ready, authenticated, login, logout } = usePrivy();
  if (!ready) return null;
  if (!authenticated) return <button type="button" className="site-nav-cta site-nav-cta--creator" onClick={login}>Sign in</button>;
  return <button type="button" className="site-nav-cta site-nav-cta--creator" onClick={() => void logout()}>Sign out</button>;
}
