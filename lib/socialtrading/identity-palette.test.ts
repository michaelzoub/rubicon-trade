import { describe, expect, it } from "vitest";
import { hexToHsl, hslToHex, identityPalette, identityVars, maturityOf } from "./identity-palette";
import type { HubState } from "./types";

const learned = (id: string, weight: number, confidence: number): HubState["inferred"][number] =>
  ({ id, weight, confidence, count: 4, updatedAt: "2026-09-16T00:00:00.000Z" });

describe("colour conversion", () => {
  it("round-trips a hex through HSL", () => {
    for (const hex of ["#6f8fba", "#a28d53", "#73a293", "#ffffff", "#000000"]) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });
});

describe("identityPalette", () => {
  it("stays near neutral for a new identity and saturates as depth grows", () => {
    const fresh = identityPalette("seed", ["crypto"], [], 0);
    const grown = identityPalette("seed", ["crypto"], [], 200);
    expect(hexToHsl(fresh.accent).s).toBeLessThan(0.15);
    expect(hexToHsl(grown.accent).s).toBeGreaterThan(0.5);
    // The hue is the belief, so it must not move as the person progresses.
    expect(fresh.hue).toBe(grown.hue);
  });

  it("keeps every tone inside the band that protects the light base", () => {
    const themes = [["crypto"], ["energy", "healthcare"], ["ai", "tech", "consumer"], []] as const;
    for (const picked of themes) {
      for (const depth of [0, 40, 130, 400]) {
        const palette = identityPalette("seed", [...picked], [], depth);
        expect(hexToHsl(palette.accent).l).toBeCloseTo(0.47, 2);
        expect(hexToHsl(palette.soft).l).toBeGreaterThan(0.85);
        expect(hexToHsl(palette.deep).l).toBeLessThan(0.35);
        expect(hexToHsl(palette.wash).l).toBeGreaterThan(0.95);
        expect(hexToHsl(palette.accent).s).toBeLessThanOrEqual(0.55);
      }
    }
  });

  it("gives an unformed identity a hue of its own rather than grey", () => {
    const seeds = ["person-a", "person-b", "person-c", "person-d", "person-e"];
    const hues = new Set(seeds.map(seed => identityPalette(seed, [], [], 0).hue));
    expect(hexToHsl(identityPalette("person-a", [], [], 0).accent).s).toBeGreaterThan(0);
    expect(hues.size).toBeGreaterThan(1);
  });

  it("lets what the agent learned shade the hue without taking it over", () => {
    const chosen = identityPalette("seed", ["crypto"], [], 200);
    const shaded = identityPalette("seed", ["crypto"], [learned("healthcare", 1, 1)], 200);
    const pure = identityPalette("seed", ["healthcare"], [], 200);
    const drift = Math.abs(shaded.hue - chosen.hue);
    const full = Math.abs(pure.hue - chosen.hue);
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(full / 2);
  });

  it("ignores an inferred theme the agent has no confidence in", () => {
    const base = identityPalette("seed", ["crypto"], [], 120);
    const noisy = identityPalette("seed", ["crypto"], [learned("energy", 0.8, 0)], 120);
    expect(noisy.accent).toBe(base.accent);
  });

  it("publishes the tokens surfaces read", () => {
    const vars = identityVars(identityPalette("seed", ["tech"], [], 70));
    expect(Object.keys(vars)).toEqual(["--id-accent", "--id-accent-soft", "--id-accent-deep", "--id-wash", "--id-maturity"]);
    expect(vars["--id-accent"]).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("maturityOf", () => {
  it("runs from nothing to full across the identity stages and clamps beyond", () => {
    expect(maturityOf(0)).toBe(0);
    expect(maturityOf(200)).toBe(1);
    expect(maturityOf(1000)).toBe(1);
    expect(maturityOf(-5)).toBe(0);
    expect(maturityOf(30)).toBeGreaterThan(30 / 200);
  });
});
