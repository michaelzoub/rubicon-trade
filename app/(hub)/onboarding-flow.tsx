"use client";

import { useEffect, useState } from "react";
import type { InvestingProfile } from "@/lib/socialtrading/profile";
import { DEFAULT_PLAN } from "@/lib/socialtrading/plans";
import { resolveAssignment, type Assignment } from "@/lib/socialtrading/experiment";
import { LoadingState } from "../_components/ui";
import { TreeOnboarding } from "./onboarding-tree";
import { InferenceOnboarding } from "./onboarding-inference";

export type ProfileFlowProps = {
  userId: string; name?: string;
  onComplete?: (profile: InvestingProfile) => void | Promise<void>;
  completing?: boolean; serverError?: string; persist?: boolean; agentCreation?: boolean;
  plan?: { name: string; limits: typeof DEFAULT_PLAN.limits };
};

/** The experiment's only seam. Both arms take the same props and call the same
 * `onComplete`, so the hub, the agent creator, and the preview mount onboarding
 * without knowing which one they got. Assignment is resolved after mount
 * because `?onboarding=` is not visible during server rendering, and a variant
 * chosen on the server would not survive hydration. */
export function ProfileFlow(props: ProfileFlowProps) {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  useEffect(() => { setAssignment(resolveAssignment(props.userId, window.location.search)); }, [props.userId]);
  if (!assignment) return <LoadingState label="Loading…" />;
  const Arm = assignment.variant === "inference" ? InferenceOnboarding : TreeOnboarding;
  return <Arm {...props} variant={assignment.variant} forced={assignment.forced} />;
}
