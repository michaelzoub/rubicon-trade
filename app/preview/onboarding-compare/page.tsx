import type { Metadata } from "next";
import { CompareRuns } from "./compare";

export const metadata: Metadata = { title: "Onboarding A/B | Rubicon", robots: { index: false, follow: false } };

export default function OnboardingComparePage() {
  return <CompareRuns />;
}
