import { describe, expect, it } from "vitest";
import { limitsError, newProfile, profileKey, readProfile } from "./profile";

describe("investing profile", () => {
  it("defaults to notification-only and isolates stored profiles by identity", () => {
    const profile = { ...newProfile("alice"), thesis: "AI infrastructure", step: 4 };
    expect(profile.permission).toBe("notify");
    expect(profileKey("alice")).not.toBe(profileKey("bob"));
    expect(readProfile(JSON.stringify(profile), "bob").thesis).toBe("");
    expect(readProfile(JSON.stringify(profile), "alice").thesis).toBe("AI infrastructure");
  });
  it("recovers safely from corrupted or incompatible storage", () => {
    for (const raw of ["{", "null", JSON.stringify({ ...newProfile("alice"), permission: "toString" })]) {
      expect(readProfile(raw, "alice").step).toBe(1);
      expect(readProfile(raw, "alice").permission).toBe("notify");
    }
  });
  it("requires finite positive monetary limits and consistent ceilings", () => {
    for (const perTrade of ["", "0", "-1", "NaN", "Infinity", "1.001", "1e3", "99999999999999999"]) {
      expect(limitsError({ perTrade, daily: "100", weekly: "500" })).not.toBeNull();
    }
    expect(limitsError({ perTrade: "101", daily: "100", weekly: "500" })).not.toBeNull();
    expect(limitsError({ perTrade: "10", daily: "501", weekly: "500" })).not.toBeNull();
    expect(limitsError({ perTrade: "10.50", daily: "100", weekly: "500" })).toBeNull();
  });
  it("returns incomplete automatic profiles to permissions instead of confirming them", () => {
    const original = newProfile("alice");
    const profile = { ...original, thesis: "Energy", investorAnswers: { ...original.investorAnswers, knowledge: 4 }, permission: "automatic", step: 6 };
    expect(readProfile(JSON.stringify(profile), "alice").step).toBe(5);
  });
});
