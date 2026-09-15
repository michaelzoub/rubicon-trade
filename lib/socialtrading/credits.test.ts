import { describe, expect, it } from "vitest";
import { MemoryCreditLedger, meteredModel, OutOfCredits, parseOpenRouterUsage, usageToCharge } from "./credits";
import type { ModelClient } from "./runtime/types";

const scope = { userId: "u", agentId: "a", source: "chat" as const, ref: "m1" };

describe("usage parsing and charges", () => {
  it("charges OpenRouter's reported cost, rounded up to a micro", () => {
    const usage = parseOpenRouterUsage({ id: "gen-1", model: "openai/gpt-4.1-mini", usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.0004321 } })!;
    expect(usage).toMatchObject({ promptTokens: 1200, completionTokens: 80, costUsd: 0.0004321, requestId: "gen-1" });
    expect(usageToCharge(usage)).toEqual({ costMicros: 433, costSource: "openrouter" });
  });
  it("falls back to a token estimate when cost is missing", () => {
    const usage = parseOpenRouterUsage({ usage: { prompt_tokens: 500_000, completion_tokens: 500_000 } })!;
    expect(usage.costUsd).toBeNull();
    expect(usageToCharge(usage, 2)).toEqual({ costMicros: 2_000_000, costSource: "estimate" });
    expect(parseOpenRouterUsage({})).toBeNull();
  });
});

describe("MemoryCreditLedger", () => {
  it("reserves atomically, settles to the real cost, and refuses when a hold cannot be covered", async () => {
    const ledger = new MemoryCreditLedger({ u: 30_000 });
    const first = await ledger.reserve(scope, 20_000);
    expect(first).not.toBeNull();
    expect(await ledger.reserve(scope, 20_000)).toBeNull();
    expect(await ledger.settle(first!, { promptTokens: 10, completionTokens: 5, costUsd: 0.0005, requestId: null, model: null }, { costMicros: 500, costSource: "openrouter" })).toBe(29_500);
    // Settling twice never charges twice.
    expect(await ledger.settle(first!, { promptTokens: 10, completionTokens: 5, costUsd: 0.0005, requestId: null, model: null }, { costMicros: 500, costSource: "openrouter" })).toBe(29_500);
    const second = await ledger.reserve(scope, 20_000);
    expect(await ledger.release(second!)).toBe(29_500);
    expect(ledger.entries.map(e => e.status)).toEqual(["settled", "released"]);
  });
});

describe("meteredModel", () => {
  const inner = (reply: Partial<Awaited<ReturnType<ModelClient["complete"]>>> | Error): ModelClient => ({ async complete() { if (reply instanceof Error) throw reply; return { content: "", toolCalls: [], ...reply }; } });
  it("holds before the call and settles after it", async () => {
    const ledger = new MemoryCreditLedger({ u: 100_000 });
    const model = meteredModel(inner({ content: "hi", usage: { promptTokens: 100, completionTokens: 20, costUsd: 0.001, requestId: "gen-9", model: "openai/gpt-4.1-mini" } }), ledger, scope, 20_000);
    expect((await model.complete({ messages: [], tools: [], toolChoice: "auto" })).content).toBe("hi");
    expect(ledger.read("u")).toBe(99_000);
    expect(ledger.entries[0]).toMatchObject({ status: "settled", costMicros: 1000, ref: "m1", usage: expect.objectContaining({ requestId: "gen-9" }) });
  });
  it("refuses before calling the provider when the balance is too low, and releases the hold when the provider fails", async () => {
    const ledger = new MemoryCreditLedger({ u: 10_000 });
    await expect(meteredModel(inner({ content: "never" }), ledger, scope, 20_000).complete({ messages: [], tools: [], toolChoice: "auto" })).rejects.toBeInstanceOf(OutOfCredits);
    expect(ledger.entries).toEqual([]);
    const failing = new MemoryCreditLedger({ u: 50_000 });
    await expect(meteredModel(inner(new Error("upstream")), failing, scope, 20_000).complete({ messages: [], tools: [], toolChoice: "auto" })).rejects.toThrow("upstream");
    expect(failing.read("u")).toBe(50_000);
    expect(failing.entries[0].status).toBe("released");
  });
});
