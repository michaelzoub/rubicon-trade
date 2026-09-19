import { describe, expect, it } from "vitest";
import { commitOf, forceOf, leanOf, poseOf, FLICK, THROW } from "./onboarding-throw";

describe("swipe throw physics", () => {
  it("leans into the dominant well and reports how committed the throw looks", () => {
    expect(leanOf(8, 0)).toBeNull();
    expect(leanOf(40, 4)).toBe("yes");
    expect(leanOf(-40, 4)).toBe("no");
    expect(leanOf(10, 40)).toBe("unsure");
    expect(forceOf(THROW / 2, 0)).toBeCloseTo(0.5);
    expect(forceOf(THROW * 3, 0)).toBe(1);
  });

  it("commits from distance or from a flick, with position winning a mixed gesture", () => {
    expect(commitOf(THROW + 1, 0)).toBe("yes");
    expect(commitOf(-(THROW + 1), 0)).toBe("no");
    expect(commitOf(0, THROW + 1)).toBe("unsure");
    expect(commitOf(10, 0, FLICK + 20)).toBe("yes");
    expect(commitOf(-10, 0, -(FLICK + 20))).toBe("no");
    expect(commitOf(0, 20, 0, FLICK + 20)).toBe("unsure");
    // Dragged past the left well even if the release flicks right.
    expect(commitOf(-(THROW + 8), 4, FLICK + 40)).toBe("no");
    expect(commitOf(12, 8)).toBeNull();
  });

  it("keeps the card straight at rest, tilts with x, and shrinks on a downward drag", () => {
    expect(poseOf(0, 0)).toEqual({ rotation: 0, scale: 1 });
    expect(poseOf(36, 0).rotation).toBe(2);
    expect(poseOf(-36, 0).rotation).toBe(-2);
    expect(poseOf(0, 90).scale).toBeCloseTo(0.9);
    expect(poseOf(0, 90).rotation).toBe(0);
  });
});
