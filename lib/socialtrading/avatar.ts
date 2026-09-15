// Stable, versioned facial and material traits. Selected themes blend the
// material separately, so edits never change the underlying identity.
export function avatarTraits(userId: string) {
  let state = 2166136261;
  for (const char of `rubicon-avatar-v1:${userId}`) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  const pick = (count: number) => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) % count;
  };
  return {
    color: pick(6), pattern: pick(4), face: pick(3),
    eyes: pick(3), mouth: pick(2), accessory: pick(2),
  };
}
