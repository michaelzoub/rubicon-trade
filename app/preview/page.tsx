import type { Metadata } from "next";
import { PreviewExperience } from "./preview-hub";

export const metadata: Metadata = { title: "Social trading preview | Rubicon", robots: { index: false, follow: false } };

/** Fixture-backed rendering of the hub for design review without signing in.
 * Onboarding and hub state stay local to this visit. */
export default async function SocialTradingPreviewPage({ searchParams }: { searchParams: Promise<{ view?: string; kind?: string; id?: string }> }) {
  const { view, kind, id } = await searchParams;
  return <PreviewExperience view={view ?? "home"} kind={kind} id={id} />;
}
