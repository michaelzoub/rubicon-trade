import { expect, it } from "vitest";
import { agentConfig, defaultAgent, normalizeAgent } from "./config";

it("fills defaults for configurations stored before notifications existed and never trusts enabled from the blob", () => {
  const legacy = { id: "default", name: "My agent", description: "", instructions: "", capabilities: ["profile", "market", "trading"], createdAt: "2026-09-14T00:00:00.000Z", enabled: true };
  const agent = normalizeAgent(legacy, "default", false);
  expect(agent).toMatchObject({ id: "default", enabled: false, notifications: { cadenceMinutes: 60, threshold: "medium", maxPerDay: 3 } });
  expect(normalizeAgent(null, "x", true)).toMatchObject({ id: "x", enabled: true, name: "My agent" });
  expect(normalizeAgent({ ...legacy, capabilities: ["market", "bogus"], notifications: { cadenceMinutes: 7, threshold: "loud", maxPerDay: 99 } }, "default").capabilities).toEqual(["market"]);
  expect(normalizeAgent({ ...legacy, notifications: { cadenceMinutes: 180, threshold: "high", maxPerDay: 2 } }, "default").notifications).toEqual({ cadenceMinutes: 180, threshold: "high", maxPerDay: 2 });
});
it("validates notification preferences and keeps enabled server-owned on save", () => {
  const existing = { ...defaultAgent("a"), enabled: true };
  const saved = agentConfig({ ...existing, enabled: false, notifications: { cadenceMinutes: 1440, threshold: "low", maxPerDay: 1 } }, existing);
  expect(saved.enabled).toBe(true);
  expect(saved.notifications).toEqual({ cadenceMinutes: 1440, threshold: "low", maxPerDay: 1 });
  expect(agentConfig({ ...existing, notifications: undefined }, existing).notifications).toEqual(existing.notifications);
  for (const notifications of [null, { cadenceMinutes: 45, threshold: "low", maxPerDay: 1 }, { cadenceMinutes: 60, threshold: "urgent", maxPerDay: 1 }, { cadenceMinutes: 60, threshold: "low", maxPerDay: 0 }, { cadenceMinutes: 60, threshold: "low", maxPerDay: 13 }]) {
    expect(() => agentConfig({ ...existing, notifications }, existing)).toThrow(/notification/);
  }
});
