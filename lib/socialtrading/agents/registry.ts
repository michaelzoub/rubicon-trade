import type { HubState, MessagePart } from "../types";
import { defaultAgent } from "./config";
export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: unknown } };
export type AgentContext<S = unknown> = { userId: string; agentId: string; state: HubState; services: S; signal?: AbortSignal;
  /** The user's plan caps. Tools that add to the profile add only what fits and report the rest. */
  limits: import("../plans").PlanLimits };
export interface AgentCapability<S = unknown> {
  id: string;
  tools: readonly { schema: ToolSchema; execute: (args: Record<string, unknown>, context: AgentContext<S>) => Promise<{ result: unknown; parts: MessagePart[] }> }[];
}
/** Explicit composition, no global mutable registration or UI dependency. */
export class CapabilityRegistry<S = unknown> {
  private tools = new Map<string, { capability: string; tool: AgentCapability<S>["tools"][number] }>();
  constructor(capabilities: readonly AgentCapability<S>[]) {
    const ids = new Set<string>();
    for (const capability of capabilities) {
      if (ids.has(capability.id)) throw new Error(`Duplicate capability: ${capability.id}`);
      ids.add(capability.id);
      for (const tool of capability.tools) {
        const name = tool.schema.function.name;
        if (this.tools.has(name)) throw new Error(`Duplicate tool: ${name}`);
        this.tools.set(name, { capability: capability.id, tool });
      }
    }
  }
  schemas(state: HubState) {
    const enabled = (state.agent ?? defaultAgent()).capabilities;
    return [...this.tools.values()].filter(t => enabled.includes(t.capability)).map(t => t.tool.schema);
  }
  async execute(name: string, args: Record<string, unknown>, context: AgentContext<S>) {
    const entry = this.tools.get(name);
    if (!entry || !(context.state.agent ?? defaultAgent()).capabilities.includes(entry.capability)) throw new Error("This capability is disabled for this agent.");
    if (context.agentId !== (context.state.agent?.id ?? "default") || context.userId !== context.state.profile.userId) throw new Error("Agent context mismatch.");
    return entry.tool.execute(args, context);
  }
}
