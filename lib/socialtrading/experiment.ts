/** The onboarding A/B/C layer. Three arms ask for the same profile by
 * different means: `tree` walks the fixed decision tree, `inference` lets the
 * model write each next card, and `adaptive` scores the accumulated evidence
 * with Jev and picks the next probe from what it still does not know. Assignment is a pure
 * function of the user id, so a reload, a second tab, and the compare page all
 * agree on which arm someone is in without storing anything. */
export const VARIANTS = ["tree", "inference", "adaptive"] as const;
export type Variant = (typeof VARIANTS)[number];

export const isVariant = (value: unknown): value is Variant => typeof value === "string" && (VARIANTS as readonly string[]).includes(value);

/** FNV-1a. Small, stable across runtimes, and good enough to split a cohort. */
function hash(value: string) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The arm this user belongs to. Deterministic: same id, same arm, forever. */
export function onboardingVariant(userId: string): Variant {
  return VARIANTS[hash(`onboarding:${userId}`) % VARIANTS.length];
}

export type Assignment = { variant: Variant; forced: boolean };

/** `?onboarding=tree|inference` overrides the hash so both arms can be opened
 * side by side. A forced run is flagged, and the compare page keeps it out of
 * the rates it reports — steering yourself into an arm is not a sample. */
export function resolveAssignment(userId: string, search?: string | null): Assignment {
  const override = new URLSearchParams(search ?? "").get("onboarding");
  return isVariant(override) ? { variant: override, forced: true } : { variant: onboardingVariant(userId), forced: false };
}
