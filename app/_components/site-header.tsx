"use client";

import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { HubLink as Link } from "../(hub)/_hub/navigation";
import { usePrivyConfigured } from "../providers";
import { RubiconBrand } from "./rubicon-brand";

/** `session` shows the plain Sign in / Sign out button; the hub passes false because its account menu carries sign-out.
 * `nav` is the hub's tab bar, which rides inside this header so the app shows one band of chrome instead of two. */
export function SiteHeader({ accountStatus, session = true, nav }: { accountStatus?: ReactNode; session?: boolean; nav?: ReactNode }) {
  const configured = usePrivyConfigured();
  return (
    <header className={`site-header${nav ? " site-header--hub" : ""}`}>
      <nav className="container site-header-inner" aria-label="Main navigation">
        <Link href="/" className="site-header-logo" aria-label="Rubicon home">
          <RubiconBrand className="site-header-brand site-header-brand--new" src="/Header-logo_w.svg" />
        </Link>
        <div className="site-header-links">{nav}</div>
        <div className="site-header-actions">{accountStatus}{session && configured && <Session />}</div>
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
