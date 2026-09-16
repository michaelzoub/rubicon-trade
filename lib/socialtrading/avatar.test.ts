import { describe, expect, it } from "vitest";
import { newProfile, readProfile } from "./profile";
import { agentAvatarTraits, avatarTraits } from "./avatar";

describe("agent avatar identity", () => {
  it("is deterministic across calls and contains all composable traits", () => {
    expect(avatarTraits("alice")).toEqual(avatarTraits("alice"));
    expect(Object.keys(avatarTraits("alice"))).toHaveLength(6);
  });
  it("produces distinct combinations and reaches every variant", () => {
    const examples = Array.from({ length: 1000 }, (_, i) => avatarTraits(`user-${i}`));
    expect(new Set(examples.map(t => JSON.stringify(t))).size).toBeGreaterThan(550);
    for (const [key, count] of Object.entries({ color: 6, pattern: 4, face: 5, eyes: 4, mouth: 3, accessory: 2 })) {
      expect(new Set(examples.map(t => t[key as keyof typeof t])).size).toBe(count);
    }
  });
});

describe("choice-driven agent badges", () => {
  it("retains the preview identity after saving and assigning an agent ID", () => {
    const profile = { ...newProfile("alice"), avatarSeed: "unique-draft-seed" };
    const saved = readProfile(JSON.stringify(profile), "alice");
    expect(saved.avatarSeed).toBe(profile.avatarSeed);
    expect(agentAvatarTraits("new-agent-id", saved)).toEqual(agentAvatarTraits("alice", profile));
    expect(agentAvatarTraits("alice", { ...profile, avatarSeed: "another-agent" })).not.toEqual(agentAvatarTraits("alice", profile));
  });
  it("updates chosen traits without replacing the face and restores reverted choices", () => {
    const profile = newProfile("alice");
    const initial = agentAvatarTraits("agent", profile);
    const edited = { ...profile, permissionConfigured: true, permission: "automatic" as const,
      investorAnswers: { ...profile.investorAnswers, knowledge: 3, esgPriority: 4 } };
    expect(agentAvatarTraits("agent", edited)).toMatchObject({ face: initial.face, eyes: 3, mouth: 2, accessory: 1 });
    expect(agentAvatarTraits("agent", profile)).toEqual(initial);
  });
  it("ignores choice ordering and profile timestamps", () => {
    const profile = { ...newProfile("alice"), themes: ["ai", "crypto"] as const };
    const first = { ...profile, themes: [...profile.themes] };
    expect(agentAvatarTraits("agent", first)).toEqual(agentAvatarTraits("agent", {
      ...first, themes: ["crypto", "ai"], updatedAt: "later", step: 6,
    }));
  });
});
