import type { Metadata } from "next";
import { PreviewHub } from "./preview-hub";

export const metadata: Metadata = { title: "Social trading preview | Rubicon", robots: { index: false, follow: false } };

/** Fixture-backed rendering of the hub for design review without signing in.
 * Nothing here reaches a server; sends fail softly. */
export default async function SocialTradingPreviewPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  return <PreviewHub view={view ?? "home"} />;
}
