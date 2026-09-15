import "server-only";
import { CRYPTO_TOOLS, cryptoToolGroup, executeCryptoTool } from "@/lib/crypto/agent";
import { executeTool, TOOL_SCHEMAS } from "../agent/tools";
import { CapabilityRegistry } from "./registry";
import type { AgentServices } from "./services";
const groups: Record<string, readonly string[]> = {
  profile: ["get_profile", "update_profile", "recall_activity"],
  market: ["search_assets", "get_asset", "list_ipos", "trending_crypto", "explain_relevance"],
  trading: ["propose_trade"],
};
export const capabilities = new CapabilityRegistry<AgentServices>(Object.entries(groups).map(([id, names]) => ({
  id, tools: [...CRYPTO_TOOLS.filter(schema => cryptoToolGroup(schema.function.name) === id).map(schema => ({ schema, execute: (args: Record<string, unknown>, context: import("./registry").AgentContext<AgentServices>) => executeCryptoTool(schema.function.name, args, context) })), ...TOOL_SCHEMAS.filter(schema => names.includes(schema.function.name)).map(schema => ({
    schema, execute: (args: Record<string, unknown>, context: import("./registry").AgentContext<AgentServices>) => executeTool(schema.function.name, args, context.state, context.userId, context.services, context.limits),
  }))],
})));
