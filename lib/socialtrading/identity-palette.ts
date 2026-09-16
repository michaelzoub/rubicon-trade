import { THEMES, type ThemeId } from "./themes";
import { identityHash } from "./identity";
import type { HubState } from "./types";

/**
 * The accent the whole product wears, derived rather than chosen. Hue comes
 * from what the person believes; chroma comes from how much the agent has
 * learned, so colour is the progression bar. A brand-new account is close to
 * neutral and a developed identity is fully saturated, and no blend of themes
 * can escape the band that keeps Rubicon's base light and calm.
 */
export type IdentityPalette = {
  /** The accent itself, for marks, edges and active state. */
  accent: string;
  /** A tint for fills behind content. */
  soft: string;
  /** A weight for text on light fills and for depth. */
  deep: string;
  /** The faintest wash, for whole-surface atmosphere. */
  wash: string;
  /** The derived hue in degrees. Survives the 8-bit rounding the hexes suffer,
   * so motion and canvas work can tint from the identity exactly. */
  hue: number;
  /** How far along the identity is, 0–1. Drives chroma and is reused by surfaces. */
  maturity: number;
};

/** Depth is an open-ended score; 200 is the last stage threshold in identity.ts. */
export const maturityOf = (depth: number) => Math.min(1, Math.max(0, depth / 200) ** 0.7);

type HSL = { h: number; s: number; l: number };

export function hexToHsl(hex: string): HSL {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  const l = (max + min) / 2;
  if (span === 0) return { h: 0, s: 0, l };
  const s = span / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / span + (g < b ? 6 : 0)) : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  return { h: h * 60, s, l };
}

export function hslToHex({ h, s, l }: HSL): string {
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const second = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const shift = l - chroma / 2;
  const [r, g, b] = (
    h < 60 ? [chroma, second, 0] : h < 120 ? [second, chroma, 0] : h < 180 ? [0, chroma, second] :
    h < 240 ? [0, second, chroma] : h < 300 ? [second, 0, chroma] : [chroma, 0, second]
  ).map(channel => Math.round(Math.min(255, Math.max(0, (channel + shift) * 255))));
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * How far a blend may pull the leading theme's hue, in degrees. Small on
 * purpose: neighbouring themes should visibly mix, but two distant ones must
 * not swing the accent onto a third colour — the short way round from gold to
 * violet runs through red, which belongs to neither.
 */
const PULL = 14;

/** Signed shortest way round the wheel, from one hue to another. */
const between = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/**
 * The heaviest theme sets the hue; everything else pulls it, but only so far.
 * A plain circular mean would invent a third colour — energy and AI averaging
 * into a pink that belongs to neither — so the pull is bounded and the accent
 * stays recognisably the thing the person leads with.
 */
function blendHue(parts: readonly { hue: number; weight: number }[]): number {
  const leader = parts.reduce((best, part) => part.weight > best.weight ? part : best);
  const x = parts.reduce((sum, p) => sum + p.weight * Math.cos(p.hue * Math.PI / 180), 0);
  const y = parts.reduce((sum, p) => sum + p.weight * Math.sin(p.hue * Math.PI / 180), 0);
  if (x === 0 && y === 0) return leader.hue;
  const resultant = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  const pull = between(leader.hue, resultant);
  return (leader.hue + Math.max(-PULL, Math.min(PULL, pull)) + 360) % 360;
}

/**
 * Explicit themes carry full weight; what the agent worked out on its own
 * counts for a third, matching the badge, so learning shades the identity
 * without taking it over.
 */
export function identityPalette(
  seed: string,
  themes: readonly ThemeId[],
  inferred: HubState["inferred"] = [],
  depth = 0,
): IdentityPalette {
  const maturity = maturityOf(depth);
  const explicit = THEMES.filter(t => themes.includes(t.id)).map(t => ({ hue: hexToHsl(t.color).h, weight: 1 }));
  const learned = THEMES
    .filter(t => !themes.includes(t.id))
    .flatMap(t => {
      const match = inferred.find(i => i.id === t.id);
      if (!match || match.weight <= 0) return [];
      return [{ hue: hexToHsl(t.color).h, weight: Math.min(1, match.weight * Math.max(0, match.confidence)) / 3 }];
    });
  const parts = [...explicit, ...learned];
  // An identity with nothing declared is still theirs: the seed picks a hue.
  const hue = parts.length ? blendHue(parts) : identityHash(seed) % 360;

  // The band. Chroma opens up as the agent learns; lightness never leaves the
  // range that keeps text legible on Rubicon's light base.
  const chroma = 0.1 + 0.44 * maturity;
  return {
    accent: hslToHex({ h: hue, s: chroma, l: 0.47 }),
    soft: hslToHex({ h: hue, s: Math.min(0.5, chroma * 0.75), l: 0.91 }),
    deep: hslToHex({ h: hue, s: Math.min(0.58, chroma * 1.1), l: 0.28 }),
    wash: hslToHex({ h: hue, s: Math.min(0.42, chroma * 0.6), l: 0.975 }),
    hue,
    maturity,
  };
}

/** The custom properties every surface reads. Set once, high in the tree. */
export function identityVars(palette: IdentityPalette): Record<string, string> {
  return {
    "--id-accent": palette.accent,
    "--id-accent-soft": palette.soft,
    "--id-accent-deep": palette.deep,
    "--id-wash": palette.wash,
    "--id-maturity": palette.maturity.toFixed(3),
  };
}
