import { describe, expect, it } from "vitest";
import { agentSpend, remainingAllowance, tradePolicy } from "./policy";
import { newProfile } from "./profile";
import type { TradeIntent } from "./types";

const base = { ...newProfile("alice"), thesis: "Energy", permissionConfigured: true, step: 5 as const, completedAt: "2026-09-14T00:00:00Z" };
const trade = (value: number, status: TradeIntent["status"], minutesAgo = 5): TradeIntent => ({
  id: crypto.randomUUID(), asset: { id: "VRT", symbol: "VRT", name: "Vertiv", kind: "stock" }, side: "buy", value, estimatedPrice: null, estimatedQuantity: null, resultingExposure: value,
  createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(), status, reasoning: "", policy: { allowed: true, reason: "", at: "" },
});

describe("trade policy", () => {
  it("never allows trades in Notify me mode", () => {
    expect(tradePolicy({ ...base, permission: "notify" }, 10, [], true).allowed).toBe(false);
  });
  it("asks for approval in Ask mode even without limits, then allows once approved", () => {
    const profile = { ...base, permission: "approve" as const };
    const first = tradePolicy(profile, 50, [], false);
    expect(first.allowed).toBe(false);
    expect(first.needsApproval).toBe(true);
    expect(tradePolicy(profile, 50, [], true).allowed).toBe(true);
  });
  it("still enforces saved limits in Ask mode", () => {
    const profile = { ...base, permission: "approve" as const, limits: { perTrade: "25", daily: "100", weekly: "500" } };
    expect(tradePolicy(profile, 30, [], true).reason).toMatch(/per-trade/);
    expect(tradePolicy(profile, 20, [], true).allowed).toBe(true);
  });
  it("requires valid limits and rolling windows in automatic mode", () => {
    const missing = { ...base, permission: "automatic" as const };
    expect(tradePolicy(missing, 10, [], false).allowed).toBe(false);
    const profile = { ...missing, limits: { perTrade: "25", daily: "40", weekly: "60" } };
    expect(tradePolicy(profile, 25, [], false).allowed).toBe(true);
    expect(tradePolicy(profile, 20, [trade(25, "confirmed")], false).reason).toMatch(/24-hour/);
    expect(tradePolicy(profile, 20, [trade(25, "rejected")], false).allowed).toBe(true);
    expect(tradePolicy(profile, 20, [trade(25, "confirmed", 60 * 25), trade(20, "submitted", 60 * 26)], false).reason).toMatch(/7-day/);
    expect(tradePolicy(profile, 0.001, [], false).allowed).toBe(false);
  });
});

describe("agent spending invariant", () => {
  const limits = { ...base, permission: "automatic" as const, limits: { perTrade: "50", daily: "100", weekly: "150" } };
  const swap = (value: number, status: TradeIntent["status"], phase: "ready" | "issued" | "complete", hoursAgo: number, initiator?: TradeIntent["initiator"]): TradeIntent => ({ ...trade(value, status, hoursAgo * 60), initiator, crypto: { request: { chainId: 1, tokenIn: "0x1", tokenOut: "0x2", amount: "1", slippageBps: 50, wallet: "0x3" }, outputAmount: "1", minimumOutput: "1", expiresAt: 0, phase } });

  it("refuses any agent trade where value + active agent spend exceeds the daily or weekly limit", () => {
    const active = [trade(40, "confirmed"), trade(30, "submitted"), trade(20, "unknown"), trade(10, "reserved")]; // 100 today
    expect(tradePolicy(limits, 0.01, active, true).reason).toMatch(/24-hour/);
    const partial = [trade(40, "confirmed"), trade(30, "reserved")]; // 70 today
    expect(tradePolicy(limits, 30, partial, true).allowed).toBe(true); // 70 + 30 == 100 is allowed
    expect(tradePolicy(limits, 30.01, partial, true).reason).toMatch(/24-hour/);
    const week = [trade(50, "confirmed", 60 * 30), trade(50, "confirmed", 60 * 60), trade(40, "confirmed", 60 * 100)]; // 140 this week, 0 today
    expect(tradePolicy(limits, 10, week, true).allowed).toBe(true);
    expect(tradePolicy(limits, 10.01, week, true).reason).toMatch(/7-day/);
    expect(tradePolicy(limits, 50.01, [], true).reason).toMatch(/per-trade/);
  });
  it("ignores declined, blocked, and failed trades and trades that fell out of the window", () => {
    const stale = [trade(100, "rejected"), trade(100, "blocked"), trade(100, "failed"), trade(100, "confirmed", 60 * 25)];
    expect(tradePolicy(limits, 50, stale, true).allowed).toBe(true);
    expect(tradePolicy(limits, 50, [...stale, trade(60, "confirmed", 60 * 24 * 8)], true).allowed).toBe(true);
  });
  it("keeps issued onchain reservations counted until the chain settles them, whatever their age", () => {
    expect(tradePolicy(limits, 50, [swap(60, "unknown", "issued", 24 * 30)], true).reason).toMatch(/24-hour/);
    expect(tradePolicy(limits, 50, [swap(60, "reserved", "ready", 24 * 30)], true).allowed).toBe(true);
    expect(tradePolicy(limits, 50, [swap(60, "failed", "complete", 1)], true).allowed).toBe(true);
    expect(tradePolicy(limits, 50, [swap(60, "confirmed", "complete", 1)], true).reason).toMatch(/24-hour/);
  });
  it("lets the user trade for themselves in any mode without consuming the agent's allowance", () => {
    const notify = { ...base, permission: "notify" as const };
    expect(tradePolicy(notify, 500, [], false, Date.now(), "user").allowed).toBe(true);
    expect(tradePolicy(limits, 5000, [], false, Date.now(), "user").allowed).toBe(true);
    expect(tradePolicy(limits, 0, [], false, Date.now(), "user").allowed).toBe(false);
    const mine = [swap(1000, "confirmed", "complete", 1, "user"), trade(90, "confirmed")];
    expect(tradePolicy(limits, 10, mine, true).allowed).toBe(true);
    expect(tradePolicy(limits, 10.01, mine, true).reason).toMatch(/24-hour/);
    expect(agentSpend(mine, 86400_000)).toBe(9000);
  });
  it("reports the remaining allowance", () => {
    expect(remainingAllowance(limits, [trade(30, "confirmed"), trade(20, "confirmed", 60 * 48)])).toEqual({ perTrade: 50, daily: 70, weekly: 100 });
    expect(remainingAllowance({ ...base, permission: "approve" }, [])).toBeNull();
  });
});
