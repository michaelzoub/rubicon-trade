export type Direction = "yes" | "no" | "unsure";

/** Pixels of travel that commit a swipe without a flick. */
export const THROW = 88;
/** GSAP reports velocity in pixels per second. */
export const FLICK = 720;

export function leanOf(x: number, y: number): Direction | null {
  const ax = Math.abs(x);
  if (y > 16 && y >= ax * 0.82) return "unsure";
  if (ax > 12) return x > 0 ? "yes" : "no";
  return null;
}

export function forceOf(x: number, y: number): number {
  const lean = leanOf(x, y);
  if (!lean) return 0;
  return Math.min(1, (lean === "unsure" ? y : Math.abs(x)) / THROW);
}

/** Position past the well wins; otherwise a flick in that direction commits. */
export function commitOf(x: number, y: number, vx = 0, vy = 0): Direction | null {
  if (y > THROW && y > Math.abs(x)) return "unsure";
  if (Math.abs(x) > THROW) return x > 0 ? "yes" : "no";
  if (vy > FLICK && vy > Math.abs(vx)) return "unsure";
  if (Math.abs(vx) > FLICK) return vx > 0 ? "yes" : "no";
  return null;
}

/** Resting pose is straight. Left/right tilt with x; a downward drag shrinks. */
export function poseOf(x: number, y: number) {
  return { rotation: x / 18, scale: 1 - Math.min(0.1, Math.max(0, y) / 900) };
}
