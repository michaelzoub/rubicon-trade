import { describe, expect, it } from "vitest";
import { onboardingVariant, resolveAssignment, VARIANTS } from "./experiment";

describe("onboarding experiment", () => {
  it("gives the same user the same arm every time", () => {
    for (const id of ["alice", "did:privy:abc123", ""]) {
      expect(onboardingVariant(id)).toBe(onboardingVariant(id));
      expect(VARIANTS).toContain(onboardingVariant(id));
    }
  });

  it("splits a cohort roughly evenly rather than collapsing onto one arm", () => {
    const ids = Array.from({ length: 400 }, (_, i) => `did:privy:user-${i}`);
    const inference = ids.filter(id => onboardingVariant(id) === "inference").length;
    expect(inference).toBeGreaterThan(140);
    expect(inference).toBeLessThan(260);
  });

  it("lets the query string force an arm, and marks that run as forced", () => {
    expect(resolveAssignment("alice", "?onboarding=inference")).toEqual({ variant: "inference", forced: true });
    expect(resolveAssignment("alice", "?onboarding=tree")).toEqual({ variant: "tree", forced: true });
    // A forced run is excluded from the rates, so the flag has to survive.
    expect(resolveAssignment("alice", "?onboarding=tree&view=onboarding").forced).toBe(true);
  });

  it("ignores an unknown or absent override and falls back to the hash", () => {
    for (const search of ["", null, undefined, "?onboarding=", "?onboarding=chat", "?other=1"]) {
      expect(resolveAssignment("alice", search)).toEqual({ variant: onboardingVariant("alice"), forced: false });
    }
  });
});
