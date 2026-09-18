import { describe, expect, it } from "vitest";
import { isVariant, onboardingVariant, resolveAssignment, VARIANTS } from "./experiment";

describe("onboarding experiment", () => {
  it("gives the same user the same arm every time", () => {
    for (const id of ["alice", "did:privy:abc123", ""]) {
      expect(onboardingVariant(id)).toBe(onboardingVariant(id));
      expect(VARIANTS).toContain(onboardingVariant(id));
    }
  });

  it("splits a cohort roughly evenly rather than collapsing onto one arm", () => {
    const ids = Array.from({ length: 600 }, (_, i) => `did:privy:user-${i}`);
    // Three arms now, so the even share is a third. The band is wide enough
    // that the hash does not have to be perfect, narrow enough that a collapse
    // onto one or two arms still fails.
    for (const variant of VARIANTS) {
      const share = ids.filter(id => onboardingVariant(id) === variant).length;
      expect(share, variant).toBeGreaterThan(120);
      expect(share, variant).toBeLessThan(280);
    }
  });

  it("gives every arm a home, including the adaptive one", () => {
    expect(VARIANTS).toEqual(["tree", "inference", "adaptive"]);
    expect(isVariant("adaptive")).toBe(true);
    expect(resolveAssignment("alice", "?onboarding=adaptive")).toEqual({ variant: "adaptive", forced: true });
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
