import { describe, expect, it } from "vitest";
import { EYES, FACE_SHAPES, MOUTHS, facePaths, gaze } from "./face";
import { avatarTraits } from "./avatar";

describe("facePaths", () => {
  it("draws the person's own seeded features at rest", () => {
    const traits = avatarTraits("someone");
    const paths = facePaths(traits);
    expect(paths.head).toBe(FACE_SHAPES[traits.face]);
    expect(paths.eyes).toBe(EYES[traits.eyes]);
    expect(paths.mouth).toBe(MOUTHS[traits.mouth]);
  });

  it("keeps the seeded head through every expression, so identity survives state", () => {
    const traits = avatarTraits("someone");
    for (const expression of ["idle", "observing", "thinking", "discovering", "wanting", "interacting"] as const) {
      expect(facePaths(traits, expression).head).toBe(FACE_SHAPES[traits.face]);
    }
  });

  it("changes the eyes when thinking and discovering, and leaves them alone when observing", () => {
    const traits = avatarTraits("someone");
    const rest = facePaths(traits);
    expect(facePaths(traits, "thinking").eyes).not.toBe(rest.eyes);
    expect(facePaths(traits, "discovering").eyes).not.toBe(rest.eyes);
    expect(facePaths(traits, "observing").eyes).toBe(rest.eyes);
  });

  it("only ever returns paths, because expressions are morphed", () => {
    for (let face = 0; face < FACE_SHAPES.length; face++) {
      for (let eyes = 0; eyes < EYES.length; eyes++) {
        for (let mouth = 0; mouth < MOUTHS.length; mouth++) {
          const paths = facePaths({ face, eyes, mouth }, "discovering");
          for (const d of Object.values(paths)) expect(d).toMatch(/^[Mm]/);
        }
      }
    }
  });
});

describe("gaze", () => {
  it("looks toward a target and rests when there is nothing to look at", () => {
    expect(gaze({ x: 0, y: 0 }, null)).toEqual({ x: 0, y: 0 });
    expect(gaze({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    const right = gaze({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(right.x).toBeCloseTo(4);
    expect(right.y).toBeCloseTo(0);
    const up = gaze({ x: 50, y: 50 }, { x: 50, y: 0 });
    expect(up.y).toBeCloseTo(-4);
  });

  it("never travels further than its reach, however far the target is", () => {
    const far = gaze({ x: 0, y: 0 }, { x: 9000, y: 9000 });
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(4);
  });
});
