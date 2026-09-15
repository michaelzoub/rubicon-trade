import type { InvestingProfile } from "./profile";
import { followedAssets, learnedAssets, LIMIT_COPY, type LimitKey, type PlanLimits } from "./plans";
import type { HubState } from "./types";

/** A limit the request would cross. `message` already tells the user what to do next. */
export type LimitViolation = { key: LimitKey; used: number; limit: number; message: string };

const plural = (n: number, key: LimitKey) => `${n} ${n === 1 ? LIMIT_COPY[key].noun : LIMIT_COPY[key].plural}`;
export const violationMessage = (key: LimitKey, limit: number, context?: string): string => {
  const cap = key === "thesisChars" ? `Your point of view can be up to ${limit.toLocaleString("en-US")} characters on this plan.`
    : `${context ?? "This plan"} allows up to ${plural(limit, key)}.`;
  return `${cap} ${LIMIT_COPY[key].remedy}`;
};

/**
 * "No new violations": a change is refused only when it pushes a quantity above the cap *and* above where it
 * already was. Data saved before a limit existed stays editable as long as the offending part shrinks or holds.
 */
export function exceeds(key: LimitKey, limits: PlanLimits, before: number, after: number, context?: string): LimitViolation | null {
  const limit = limits[key];
  if (!Number.isFinite(limit) || after <= limit || after <= before) return null;
  return { key, used: before, limit, message: violationMessage(key, limit, context) };
}

type ProfileSlice = Pick<HubState, "dislikes" | "preferences"> & { profile: Pick<InvestingProfile, "thesis" | "interests"> };
/** Checks every profile-shaped cap between two states. Used by the profile, agent, initialize, and tool paths. */
export function profileViolation(before: ProfileSlice | null, after: ProfileSlice, limits: PlanLimits): LimitViolation | null {
  const prev = before ?? { profile: { thesis: "", interests: [] }, dislikes: [], preferences: [] };
  return exceeds("thesisChars", limits, prev.profile.thesis.length, after.profile.thesis.length)
    ?? exceeds("follows", limits, followedAssets(prev.profile.interests), followedAssets(after.profile.interests), "Following")
    ?? exceeds("preferenceItems", limits, prev.profile.interests.length, after.profile.interests.length, "“Paying attention to”")
    ?? exceeds("preferenceItems", limits, prev.preferences.length, after.preferences.length, "“Things you care about”")
    ?? exceeds("preferenceItems", limits, prev.dislikes.length, after.dislikes.length, "“Show me less”");
}

export const learnedViolation = (state: Pick<HubState, "inferred">, limits: PlanLimits) => exceeds("learnedAssets", limits, learnedAssets(state.inferred), learnedAssets(state.inferred) + 1, "Memory");
