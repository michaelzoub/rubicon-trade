import { describe, expect, it } from "vitest";
import { avatarTraits } from "./avatar";

describe("agent avatar identity", () => {
  it("is deterministic across calls and contains all composable traits", () => {
    expect(avatarTraits("alice")).toEqual(avatarTraits("alice"));
    expect(Object.keys(avatarTraits("alice"))).toHaveLength(6);
  });
  it("produces distinct combinations and reaches every variant", () => {
    const examples = Array.from({ length: 1000 }, (_, i) => avatarTraits(`user-${i}`));
    expect(new Set(examples.map(t => JSON.stringify(t))).size).toBeGreaterThan(550);
    for (const [key, count] of Object.entries({ color: 6, pattern: 4, face: 5, eyes: 4, mouth: 3, accessory: 2 })) {
      expect(new Set(examples.map(t => t[key as keyof typeof t])).size).toBe(count);
    }
  });
});
