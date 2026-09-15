import type { Metadata } from "next";
import { HubShell } from "./_hub/hub-shell";

export const metadata: Metadata = {
  title: "Your trading agent | Rubicon",
  robots: { index: false, follow: false },
};

export default function SocialTradingLayout({ children }: { children: React.ReactNode }) {
  return <HubShell>{children}</HubShell>;
}
