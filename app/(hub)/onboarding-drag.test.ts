import { describe, expect, it } from "vitest";
import { clamp, intervalAt, intervalCenter, valueAt } from "./onboarding-drag";

describe("onboarding drag geometry", () => {
  it("maps a press to the value under the pointer, honouring inverted axes", () => {
    expect(valueAt({ min: 3, max: 11 }, 0)).toBe(3);
    expect(valueAt({ min: 3, max: 11 }, 1)).toBe(11);
    expect(valueAt({ min: 3, max: 11 }, 1.7)).toBe(11);
    // Confidence grows toward the top of a chart the person agrees with…
    expect(valueAt({ min: 50, max: 99, invert: true }, 0)).toBe(99);
    expect(valueAt({ min: 50, max: 99, invert: true }, 1)).toBe(50);
    // …and toward the bottom of one they disagree with.
    expect(valueAt({ min: 50, max: 99 }, 1)).toBe(99);
  });
  it("derives the stop from a continuous position without snapping it", () => {
    expect(intervalAt(0)).toBe(0); expect(intervalAt(.249)).toBe(0); expect(intervalAt(.25)).toBe(1); expect(intervalAt(.999)).toBe(3); expect(intervalAt(1)).toBe(3);
    expect(intervalCenter(2)).toBe(.625);
    expect(clamp(-1)).toBe(0); expect(clamp(2, 0, 1.5)).toBe(1.5);
  });
});
