"use client";

import { useMemo } from "react";
import { agentAvatarTraits } from "@/lib/socialtrading/avatar";
import { identityPalette } from "@/lib/socialtrading/identity-palette";
import type { Expression } from "@/lib/socialtrading/face";
import { AgentCreature } from "./agent-creature";
import { useHub } from "./hub-provider";
import "./agent-mark.css";

/**
 * The person's own agent, at the size of a mark.
 *
 * Where something is being done on their behalf, the thing doing it should be
 * the thing they see — the same creature, the same colours it wears everywhere
 * else in Rubicon, rather than a generic symbol for magic. It carries no text
 * and no state of its own; the sentence beside it says what is happening.
 */
export function AgentMark({ expression = "thinking", className = "" }: { expression?: Expression; className?: string }) {
  const { state } = useHub();
  const agentId = state.agent?.id ?? "default";
  const traits = agentAvatarTraits(agentId, state.profile);
  const palette = useMemo(() => identityPalette(agentId, state.profile.themes, state.inferred), [agentId, state.profile.themes, state.inferred]);
  return <span className={`agent-mark ${className}`.trim()} aria-hidden="true">
    <AgentCreature traits={traits} palette={palette} expression={expression} lookAt={{ from: { x: 0, y: 0 }, to: null }} />
  </span>;
}
