import type { InvestingProfile } from "./profile";

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
    color: pick(6), pattern: pick(4), face: pick(5),
    eyes: pick(4), mouth: pick(3), accessory: pick(2),
  };
}

/** Choices change the decoration; the seeded face remains recognizable. */
export function agentAvatarTraits(seed: string, profile?: InvestingProfile) {
  const traits = avatarTraits(profile?.avatarSeed ?? seed);
  if (!profile) return traits;
  const answers = profile.investorAnswers;
  const choices = avatarTraits(JSON.stringify({
    themes: [...profile.themes].sort(),
    interests: profile.interests.map(i => i.id).sort(),
    drivers: [...answers.opportunityDrivers].sort(),
    technologies: [...answers.technologies].sort(),
    countries: [...answers.conflictCountries].sort(),
  }));
  const hasChoices = profile.themes.length + profile.interests.length + answers.opportunityDrivers.length + answers.technologies.length + answers.conflictCountries.length > 0;
  return {
    ...traits,
    pattern: hasChoices ? choices.pattern : traits.pattern,
    eyes: answers.knowledge === null ? traits.eyes : Math.min(answers.knowledge, 3),
    mouth: profile.permissionConfigured ? { notify: 0, approve: 1, automatic: 2 }[profile.permission] : traits.mouth,
    accessory: answers.esgPriority === null ? traits.accessory : Number(answers.esgPriority >= 3),
  };
}
