import { agentAvatarTraits, avatarTraits } from "@/lib/socialtrading/avatar";
import { identityDepth, identityStats } from "@/lib/socialtrading/identity";
import { identityPalette, type IdentityPalette } from "@/lib/socialtrading/identity-palette";
import { agentSelectionKey, type AgentConfig } from "@/lib/socialtrading/agents/config";
import type { FaceTraits } from "@/lib/socialtrading/face";
import type { HubState } from "@/lib/socialtrading/types";

type LoadingIdentity = { traits: FaceTraits; palette: IdentityPalette };
const key = (userId: string, agentId: string) => `rubicon:loading-agent:v1:${userId}:${agentId}`;

// Only the rendered appearance is cached, never the workspace or conversation.
export function rememberLoadingAgent(userId: string, state: HubState, agents: AgentConfig[]) {
  const seed = state.agent?.id ?? "default";
  const identity: LoadingIdentity = {
    traits: agentAvatarTraits(seed, state.profile),
    palette: identityPalette(seed, state.profile.themes, state.inferred, identityDepth(state, identityStats(state, agents))),
  };
  try { localStorage.setItem(key(userId, seed), JSON.stringify(identity)); } catch { /* Storage is optional. */ }
}

export function readLoadingAgent(userId?: string): LoadingIdentity {
  if (userId) {
    try {
      const seed = localStorage.getItem(agentSelectionKey(userId)) ?? "default";
      const value = JSON.parse(localStorage.getItem(key(userId, seed)) ?? "null");
      if (value && ["face", "eyes", "mouth"].every((field, i) => Number.isInteger(value.traits?.[field]) && value.traits[field] >= 0 && value.traits[field] < [5, 4, 3][i]) &&
        ["accent", "soft", "deep", "wash"].every(field => /^#[0-9a-f]{6}$/i.test(value.palette?.[field]))) return value;
    } catch { /* First visit or unavailable storage uses a neutral agent. */ }
  }
  return { traits: avatarTraits("default"), palette: identityPalette("default", []) };
}
