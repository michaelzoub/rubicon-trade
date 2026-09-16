import { expect, it, vi } from "vitest";
import { defaultAgent } from "./config";
import { CapabilityRegistry } from "./registry";
import { PREVIEW_STATE } from "@/app/preview/fixture";

it("adds a capability without changing the runner and blocks disabled execution", async () => {
  const execute = vi.fn(async () => ({ result: "ok", parts: [] }));
  const capability = { id: "custom", tools: [{ schema: { type: "function" as const, function: { name: "custom_tool", description: "Custom service", parameters: {} } }, execute }] };
  const registry = new CapabilityRegistry([capability]);
  const state = { ...structuredClone(PREVIEW_STATE), agent: defaultAgent("agent-a") };
  const context = { userId: state.profile.userId, agentId: "agent-a", state, services: {} };
  expect(registry.schemas(state)).toEqual([]);
  await expect(registry.execute("custom_tool", {}, context)).rejects.toThrow("disabled");
  expect(execute).not.toHaveBeenCalled();
  state.agent.capabilities = ["custom"];
  expect(registry.schemas(state)).toHaveLength(1);
  await expect(registry.execute("custom_tool", {}, context)).resolves.toEqual({ result: "ok", parts: [] });
  await expect(registry.execute("custom_tool", {}, { ...context, agentId: "agent-b" })).rejects.toThrow("mismatch");
  await expect(registry.execute("custom_tool", {}, { ...context, userId: "other" })).rejects.toThrow("mismatch");
  expect(() => new CapabilityRegistry([capability, capability])).toThrow("Duplicate");
});

it("stops behavioral learning when the profile capability is disabled", async () => {
  const { learn } = await import("../personalization");
  const state = { ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent(), capabilities: ["market"] } };
  const before = structuredClone(state);
  expect(learn(state, "opened", "NEW", ["energy"])).toBeNull();
  expect(state).toEqual(before);
});
