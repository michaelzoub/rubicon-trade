import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_ASSETS, PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "../agents/config";
import { CapabilityRegistry } from "../agents/registry";
import type { HubState } from "../types";
import { OUT_OF_CREDITS_SUMMARY, runBackgroundAgent, WRITE_TOOLS } from "./background-agent";
import { latestChat } from "../chats";
import { MemoryCreditLedger } from "../credits";
import { MemoryRuntimeStore } from "./memory-store";
import type { ModelClient, ModelToolCall } from "./types";

vi.mock("../providers/market-data", () => ({ marketData: {} }));
vi.mock("../providers/crypto-data", () => ({ cryptoData: {} }));
vi.mock("../providers/brokerage", () => ({ brokerage: {}, BrokerageNotConnected: class extends Error {} }));

const USER = PREVIEW_STATE.profile.userId;
const NOW = new Date("2026-09-15T10:31:00.000Z");
const call = (name: string, args: object, id = `${name}-${Math.random().toString(36).slice(2, 6)}`): ModelToolCall => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
/** Plays back scripted turns; a turn with tool calls continues the loop, one without ends it. */
function scriptedModel(turns: { content?: string; toolCalls?: ModelToolCall[] }[]): ModelClient & { calls: Parameters<ModelClient["complete"]>[0][] } {
  const calls: Parameters<ModelClient["complete"]>[0][] = [];
  return { calls, async complete(input) { calls.push(input); const turn = turns.shift() ?? { content: "Done." }; return { content: turn.content ?? "", toolCalls: turn.toolCalls ?? [] }; } };
}
const getAsset = vi.fn(async (args: Record<string, unknown>) => ({ result: { symbol: String(args.id) }, parts: [{ type: "asset" as const, asset: { ...PREVIEW_ASSETS.VRT, id: String(args.id), symbol: String(args.id) } }] }));
const update = vi.fn(async () => ({ result: "changed", parts: [] }));
const registry = new CapabilityRegistry([
  { id: "market", tools: [{ schema: { type: "function", function: { name: "get_asset", description: "", parameters: {} } }, execute: (args) => getAsset(args) }] },
  { id: "profile", tools: [{ schema: { type: "function", function: { name: "update_profile", description: "", parameters: {} } }, execute: update }] },
  { id: "trading", tools: [{ schema: { type: "function", function: { name: "propose_trade", description: "", parameters: {} } }, execute: update }] },
]);
let store: MemoryRuntimeStore;
const agentState = (patch: Partial<NonNullable<HubState["agent"]>> = {}): HubState => ({ ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("agent-a"), name: "Power watcher", enabled: true, ...patch } });
const job = { userId: USER, agentId: "agent-a", trigger: "cron" as const, slot: "2026-09-15T10:30:00.000Z" };
const deps = (model: ModelClient) => ({ store, model, registry, services: {}, now: () => NOW });
beforeEach(() => { store = new MemoryRuntimeStore(() => NOW); store.seed(USER, agentState()); vi.clearAllMocks(); });

describe("runBackgroundAgent", () => {
  it("keeps uneventful checks out of the feed while retaining private research notes", async () => {
    const model = scriptedModel([{ toolCalls: [call("remember", { notes: ["No fresh news; checked the watchlist."] })] }, { content: "SILENT" }]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.summary).toBe("");
    expect(store.runs[0].summary).toBe("");
    expect((await store.readMemory(USER, "agent-a")).notes).toEqual(["No fresh news; checked the watchlist."]);
    expect(store.notifications).toHaveLength(0);
  });

  it("hydrates the agent, exposes only read-only tools, and stays quiet when nothing clears the bar", async () => {
    const model = scriptedModel([{ toolCalls: [call("get_asset", { id: "VRT", kind: "stock" })] }, { toolCalls: [call("remember", { notes: ["VRT flat; watch for guidance."] })] }, { content: "Checked VRT; nothing moved." }]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.status).toBe("succeeded");
    expect(outcome.decision).toMatchObject({ notified: false, toolCalls: 1, inspected: ["get_asset(VRT)"] });
    const offered = model.calls[0].tools.map(t => t.function.name);
    expect(offered).toEqual(expect.arrayContaining(["get_asset", "notify_user", "remember"]));
    for (const name of WRITE_TOOLS) expect(offered).not.toContain(name);
    const system = (model.calls[0].messages[0] as { content: string }).content;
    expect(system).toContain("Power watcher");
    expect(system).toContain(PREVIEW_STATE.profile.thesis.slice(0, 40));
    expect(system).toContain("3 reach-outs left today");
    const memory = await store.readMemory(USER, "agent-a");
    expect(memory.notes).toEqual(["VRT flat; watch for guidance."]);
    expect(memory.watched.VRT).toMatchObject({ symbol: "VRT", price: PREVIEW_ASSETS.VRT.price });
    expect(memory.lastSummary).toBe("Checked VRT; nothing moved.");
    expect(store.notifications).toEqual([]);
    expect(latestChat((await store.loadState(USER, "agent-a"))!.chats).messages).toHaveLength(PREVIEW_STATE.chats[0].messages.length);
    expect(store.runs[0]).toMatchObject({ status: "succeeded", notified: false, slot: job.slot });
  });

  it("delivers a finding above the threshold into the conversation with the cards it looked at", async () => {
    const model = scriptedModel([
      { toolCalls: [call("get_asset", { id: "VRT", kind: "stock" }), call("get_asset", { id: "CEG", kind: "stock" })] },
      { toolCalls: [call("notify_user", { title: "Vertiv raised guidance", message: "Cooling demand is running ahead of supply.", relevance: "high", assets: ["VRT"], dedupe_key: "vrt-guidance-2026-09" })] },
      { content: "Reached out about Vertiv." },
    ]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.notification).toMatchObject({ title: "Vertiv raised guidance", relevance: "high" });
    expect(store.notifications).toHaveLength(1);
    const state = (await store.loadState(USER, "agent-a"))!;
    const last = latestChat(state.chats).messages.at(-1)!;
    expect(last).toMatchObject({ role: "assistant", via: "background", status: "done" });
    expect(last.parts[0]).toEqual({ type: "text", text: "Vertiv raised guidance\n\nCooling demand is running ahead of supply." });
    expect(last.parts[1]).toMatchObject({ type: "asset", asset: { symbol: "VRT" } });
    expect(state.events.at(-1)).toMatchObject({ kind: "agent", text: "Reached out: Vertiv raised guidance" });
    expect(state.revision).toBe(PREVIEW_STATE.revision + 1);
    expect(store.runs[0]).toMatchObject({ status: "succeeded", notified: true });
    const memory = await store.readMemory(USER, "agent-a");
    expect(memory.lastNotifiedAt).toBe(NOW.toISOString());
  });

  it("enforces the user's threshold, daily cap, and dedupe outside the model", async () => {
    const notify = (relevance: string, key = "same-finding") => [{ toolCalls: [call("notify_user", { title: "Small move", message: "OKLO up 2%.", relevance, dedupe_key: key })] }, { content: "Reached out." }];
    store.seed(USER, agentState({ notifications: { cadenceMinutes: 60, threshold: "high", maxPerDay: 1 } }));
    let outcome = await runBackgroundAgent({ ...job, slot: "s1" }, deps(scriptedModel(notify("medium"))));
    expect(outcome.decision).toMatchObject({ notified: false, relevance: "medium", suppressed: expect.stringContaining("below") });
    expect(store.notifications).toHaveLength(0);
    outcome = await runBackgroundAgent({ ...job, slot: "s2" }, deps(scriptedModel(notify("high"))));
    expect(outcome.decision?.notified).toBe(true);
    outcome = await runBackgroundAgent({ ...job, slot: "s3" }, deps(scriptedModel(notify("high", "another-finding"))));
    expect(outcome.decision).toMatchObject({ notified: false, suppressed: expect.stringContaining("Daily cap") });
    store.seed(USER, agentState({ notifications: { cadenceMinutes: 60, threshold: "low", maxPerDay: 12 } }));
    outcome = await runBackgroundAgent({ ...job, slot: "s4" }, deps(scriptedModel(notify("high"))));
    expect(outcome.decision).toMatchObject({ notified: false, suppressed: "The user already heard this finding." });
    expect(store.notifications).toHaveLength(1);
  });

  it("refuses write tools even when the model asks, and respects disabled capabilities", async () => {
    store.seed(USER, agentState({ capabilities: ["profile", "trading"] }));
    const model = scriptedModel([{ toolCalls: [call("update_profile", { add_preferences: ["x"] }), call("propose_trade", { id: "VRT" }), call("get_asset", { id: "VRT" })] }, { content: "Tried things." }]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.status).toBe("succeeded");
    expect(update).not.toHaveBeenCalled();
    expect(getAsset).not.toHaveBeenCalled();
    expect(model.calls[0].tools.map(t => t.function.name)).toEqual(["notify_user", "remember"]);
    const replies = model.calls[1].messages.filter(m => m.role === "tool").map(m => JSON.parse((m as { content: string }).content));
    expect(replies[0]).toMatchObject({ error: expect.stringContaining("Not available") });
    expect(replies[2]).toMatchObject({ error: expect.stringContaining("disabled") });
  });

  it("never runs the same agent twice at once, and a slot runs only once", async () => {
    await store.claimRun(job, 600);
    expect(await runBackgroundAgent(job, deps(scriptedModel([])))).toMatchObject({ status: "skipped", runId: null });
    store.runs[0].status = "succeeded";
    expect((await runBackgroundAgent(job, deps(scriptedModel([])))).status).toBe("skipped");
    expect((await runBackgroundAgent({ ...job, slot: "2026-09-15T11:00:00.000Z" }, deps(scriptedModel([])))).status).toBe("succeeded");
    expect((await runBackgroundAgent({ ...job, trigger: "manual", slot: null }, deps(scriptedModel([])))).status).toBe("succeeded");
  });

  it("records model and provider failures on the run instead of throwing", async () => {
    const outcome = await runBackgroundAgent(job, deps({ complete: async () => { throw new Error("The model is unavailable right now."); } }));
    expect(outcome).toMatchObject({ status: "failed", error: "The model is unavailable right now." });
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "The model is unavailable right now." });
    getAsset.mockRejectedValueOnce(new Error("Market data is busy."));
    const model = scriptedModel([{ toolCalls: [call("get_asset", { id: "VRT" })] }, { content: "Data was unavailable." }]);
    const second = await runBackgroundAgent({ ...job, slot: "next" }, deps(model));
    expect(second.status).toBe("succeeded");
    expect(JSON.parse((model.calls[1].messages.at(-1) as { content: string }).content)).toEqual({ error: "Market data is busy." });
  });

  it("retries delivery once after a concurrent save and still records the notification", async () => {
    const original = store.saveState.bind(store);
    let conflicts = 0;
    store.saveState = async (userId, state) => { if (conflicts++ === 0) { const live = (await store.loadState(userId, state.agent!.id))!; latestChat(live.chats).messages.push({ id: "chat", role: "user", at: NOW.toISOString(), parts: [{ type: "text", text: "hi" }] }); await original(userId, live); } return original(userId, state); };
    const model = scriptedModel([{ toolCalls: [call("notify_user", { title: "T", message: "M", relevance: "high", dedupe_key: "k" })] }, { content: "ok" }]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.decision?.notified).toBe(true);
    const state = (await store.loadState(USER, "agent-a"))!;
    expect(latestChat(state.chats).messages.map(m => m.id)).toContain("chat");
    expect(latestChat(state.chats).messages.at(-1)?.via).toBe("background");
  });

  it("meters every model call against the ledger and skips users with no credits before claiming a run", async () => {
    const ledger = new MemoryCreditLedger({ [USER]: 100_000 });
    const priced = { promptTokens: 900, completionTokens: 60, costUsd: 0.0012, requestId: "gen-1", model: "openai/gpt-4.1-mini" };
    const model: ModelClient = { complete: async () => ({ content: "Quiet.", toolCalls: [], usage: priced }) };
    const outcome = await runBackgroundAgent(job, { ...deps(model), ledger, holdMicros: 20_000 });
    expect(outcome.status).toBe("succeeded");
    expect(ledger.read(USER)).toBe(98_800);
    expect(ledger.entries[0]).toMatchObject({ status: "settled", source: "background", ref: outcome.runId, costMicros: 1200, usage: expect.objectContaining({ requestId: "gen-1" }) });
    const broke = new MemoryCreditLedger({ [USER]: 5_000 });
    const skipped = await runBackgroundAgent({ ...job, slot: "later" }, { ...deps(model), ledger: broke, holdMicros: 20_000 });
    expect(skipped).toEqual({ runId: null, status: "skipped", summary: OUT_OF_CREDITS_SUMMARY });
    expect(store.runs.filter(r => r.slot === "later")).toEqual([]);
    expect(broke.entries).toEqual([]);
  });
});

it("does not deliver a finding after the dispatcher aborts a slow model", async () => {
  const controller = new AbortController();
  const model: ModelClient = { async complete() {
    controller.abort(new Error("Run timed out."));
    return { content: "A late finding", toolCalls: [call("notify_user", { title: "Late", message: "Late result", relevance: "high", dedupe_key: "late" })] };
  } };
  const outcome = await runBackgroundAgent(job, { ...deps(model), signal: controller.signal });
  expect(outcome.status).toBe("failed");
  expect(outcome.error).toBe("Run timed out.");
  expect(store.notifications).toHaveLength(0);
  expect(store.runs[0].status).toBe("failed");
});
