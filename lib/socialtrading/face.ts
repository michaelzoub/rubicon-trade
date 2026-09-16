/**
 * The face, as pure geometry. The badge on the profile and the creature that
 * inhabits the product draw from this one source, so the thing drifting across
 * the screen is recognisably the same agent as the one on the identity card.
 *
 * Every eye and mouth is a single path, including the ringed eyes, because the
 * creature morphs between expressions and MorphSVG needs paths to morph.
 * Coordinates are in the badge's 200x208 space.
 */

/** Seeded head shapes. Index comes from `avatarTraits().face`. */
export const FACE_SHAPES = [
  "M99 62h2a30 30 0 0 1 30 30v5a30 30 0 0 1-30 30h-2a30 30 0 0 1-30-30v-5a30 30 0 0 1 30-30Z",
  "M70 73Q72 58 100 58T130 73L125 109Q100 145 75 109Z",
  "M85 65h30a15 15 0 0 1 15 15v30a15 15 0 0 1-15 15H85a15 15 0 0 1-15-15V80a15 15 0 0 1 15-15Z",
  "M75 65Q100 52 125 65L133 94Q130 126 100 129Q70 126 67 94Z",
  "M78 63H122L130 79V106L115 126H85L70 106V79Z",
] as const;

/** Seeded eyes. Index comes from `avatarTraits().eyes`. */
export const EYES = [
  "M86 91v6m28-6v6",
  "m81 94 5-4 5 4m18 0 5-4 5 4",
  "M81 94h10m23-3v6",
  "M79 93a7 7 0 1 0 14 0a7 7 0 1 0-14 0M107 93a7 7 0 1 0 14 0a7 7 0 1 0-14 0M93 93h14",
] as const;

/** Seeded mouths. Index comes from `avatarTraits().mouth`. */
export const MOUTHS = ["M91 108q9 10 18 0", "M95 111h10", "M93 111q9 4 15-4"] as const;

/**
 * What the agent is doing, written on its face. `rest` is the badge: the
 * person's own seeded features, unmodified.
 */
export type Expression = "rest" | "idle" | "observing" | "thinking" | "discovering" | "wanting" | "interacting";

/** Half-lidded, looking down, or wide — the parts an expression overrides. */
const OVERRIDES: Partial<Record<Expression, { eyes?: string; mouth?: string }>> = {
  idle: { eyes: "M80 94h12m16 0h12", mouth: "M95 111h10" },
  thinking: { eyes: "M80 95q6 5 12 0m16 0q6 5 12 0", mouth: "M95 111h10" },
  discovering: {
    eyes: "M78 93a8 8 0 1 0 16 0a8 8 0 1 0-16 0M106 93a8 8 0 1 0 16 0a8 8 0 1 0-16 0",
    mouth: "M92 107q8 11 16 0q-8 5-16 0",
  },
  wanting: { mouth: "M91 107q9 11 18 0" },
};

export type FaceTraits = { face: number; eyes: number; mouth: number };

/** The three paths to draw, for a set of seeded traits in a given state. */
export function facePaths(traits: FaceTraits, expression: Expression = "rest") {
  const override = OVERRIDES[expression] ?? {};
  return {
    head: FACE_SHAPES[traits.face % FACE_SHAPES.length],
    eyes: override.eyes ?? EYES[traits.eyes % EYES.length],
    mouth: override.mouth ?? MOUTHS[traits.mouth % MOUTHS.length],
  };
}

/**
 * Where the pupils sit when the agent is looking at something, as an offset in
 * badge units. The agent turns its attention without moving its body, so this
 * is the whole of "looking over there".
 */
export function gaze(from: { x: number; y: number }, to: { x: number; y: number } | null, reach = 4) {
  if (!to) return { x: 0, y: 0 };
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: 0, y: 0 };
  return { x: (dx / distance) * reach, y: (dy / distance) * reach };
}
