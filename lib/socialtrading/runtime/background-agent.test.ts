import { beforeEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_ASSETS, PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "../agents/config";
import { CapabilityRegistry } from "../agents/registry";
import type { HubState } from "../types";
import { DELEGATED_TOOLS, isCheckReport, OUT_OF_CREDITS_SUMMARY, runBackgroundAgent, WRITE_TOOLS } from "./background-agent";
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

/**
 * Unattended buying, from a scheduled run.
 *
 * The grant, the limits and the signer are real elsewhere; what is checked here
 * is the part that made the feature unreachable — whether a granted run is
 * actually *invited* to buy — and that buying is one act, not a proposal the
 * run might wander away from before settling it.
 */
describe("unattended buying", () => {
  const bought: { tool: string; args: Record<string, unknown> }[] = [];
  const buy = vi.fn(async (args: Record<string, unknown>) => {
    bought.push({ tool: "buy_asset", args });
    return { result: { bought: true, symbol: "AAPLc", usd: "3", status: "confirmed", hash: "0xabc" }, parts: [] };
  });
  const cryptoRegistry = new CapabilityRegistry([
    { id: "market", tools: [
      { schema: { type: "function", function: { name: "get_asset", description: "", parameters: {} } }, execute: (args) => getAsset(args) },
      { schema: { type: "function", function: { name: "list_buyable_assets", description: "", parameters: {} } },
        execute: async () => ({ result: { assets: [{ symbol: "AAPLc", underlying: "AAPL", decimals: 8 }] }, parts: [] }) },
    ] },
    { id: "trading", tools: [
      { schema: { type: "function", function: { name: "buy_asset", description: "", parameters: {} } }, execute: buy },
      { schema: { type: "function", function: { name: "propose_crypto_swap", description: "", parameters: {} } }, execute: update },
      { schema: { type: "function", function: { name: "execute_crypto_swap", description: "", parameters: {} } }, execute: update },
      { schema: { type: "function", function: { name: "propose_trade", description: "", parameters: {} } }, execute: update },
    ] },
    { id: "profile", tools: [] },
  ]);
  const granted = async () => ({ allowed: true, reason: "", wallet: "0xf212000000000000000000000000000000001790" });
  const spender = () => { const s = agentState(); s.profile = { ...s.profile, permission: "automatic", autoExecute: true, limits: { perTrade: "3", daily: "5", weekly: "10" } }; return s; };
  const buyTurns = () => [
    { toolCalls: [call("get_asset", { id: "AAPL", kind: "stock", show_news: true })] },
    { toolCalls: [call("list_buyable_assets", {})] },
    { toolCalls: [call("buy_asset", { symbol: "AAPLc", usd: "3", reasoning: "Largest beat ever." })] },
    { content: "Bought $3 of Apple after its largest quarterly beat ever." },
  ];
  beforeEach(() => { bought.length = 0; store.seed(USER, spender()); });

  it("invites the buy as a step, and one call is the whole purchase", async () => {
    const model = scriptedModel(buyTurns());
    const outcome = await runBackgroundAgent(job, { ...deps(model), registry: cryptoRegistry, buyUnattended: granted });
    const system = (model.calls[0].messages[0] as { content: string }).content;
    // Invited, not merely permitted: offering the tool while saying "you cannot
    // trade" is what kept this unreachable, so the step has to be in the Process.
    expect(system).toContain("Acting: you may buy for them without asking");
    expect(system).toContain("$3 a trade, $5 a day");
    expect(system).not.toContain("You cannot trade");
    const offered = model.calls[0].tools.map(t => t.function.name);
    expect(offered).toContain("buy_asset");
    // The attended pair stays out of scheduled runs entirely.
    expect(offered).not.toContain("propose_crypto_swap");
    expect(offered).not.toContain("execute_crypto_swap");
    expect(bought).toHaveLength(1);
    expect(bought[0].args).toEqual({ symbol: "AAPLc", usd: "3", reasoning: "Largest beat ever." });
    expect(outcome.status).toBe("succeeded");
  });

  it("withholds the tool and refuses the call when the grant is absent", async () => {
    const model = scriptedModel(buyTurns());
    const outcome = await runBackgroundAgent(job, { ...deps(model), registry: cryptoRegistry, buyUnattended: async () => ({ allowed: false, reason: "Unattended buying is off." }) });
    const system = (model.calls[0].messages[0] as { content: string }).content;
    expect(system).toContain("You cannot trade");
    expect(system).not.toContain("Acting: you may buy");
    expect(model.calls[0].tools.map(t => t.function.name)).not.toContain("buy_asset");
    // Called anyway: refused with the reason rather than silently dropped.
    expect(bought).toEqual([]);
    const refusal = model.calls.flatMap(c => c.messages).find(m => "name" in m && m.name === "buy_asset") as { content: string } | undefined;
    expect(refusal?.content).toContain("Unattended buying is off.");
    expect(outcome.status).toBe("succeeded");
  });

  it("discloses a settled purchase in the feed even when the model forgets to", async () => {
    // The model writes about the news and says nothing about having spent money.
    const model = scriptedModel([
      { toolCalls: [call("buy_asset", { symbol: "AAPLc", usd: "3", reasoning: "Largest beat ever." })] },
      { content: "Apple reported its largest quarterly beat ever and raised guidance by 34%." },
    ]);
    const outcome = await runBackgroundAgent(job, { ...deps(model), registry: cryptoRegistry, buyUnattended: granted });
    expect(outcome.summary).toContain("Bought $3 of AAPLc for you");
    expect(outcome.summary).toContain("largest quarterly beat");
  });

  it("never lets a scheduled run sell, even while buying is granted", async () => {
    const model = scriptedModel([{ toolCalls: [call("propose_trade", { symbol: "AAPL", side: "sell" })] }, { content: "SILENT" }]);
    await runBackgroundAgent(job, { ...deps(model), registry: cryptoRegistry, buyUnattended: granted });
    const system = (model.calls[0].messages[0] as { content: string }).content;
    expect(system).toContain("Never sell");
    expect(update).not.toHaveBeenCalled();
    const refusal = model.calls.flatMap(c => c.messages).find(m => "name" in m && m.name === "propose_trade") as { content: string } | undefined;
    expect(refusal?.content).toContain("Not available during scheduled runs");
  });
});

it("keeps decimals intact when a long finding is trimmed to fit the feed", async () => {
  const long = "Apple reported its largest quarterly beat in company history with revenue of $142.8B versus $118.2B expected and EPS of $3.91 versus $2.44 for the quarter. It raised full-year guidance by 34% and announced a $200B buyback programme. Several banks moved their targets sharply higher on the back of it.";
  const model = scriptedModel([{ content: long }]);
  const outcome = await runBackgroundAgent(job, deps(model));
  expect(outcome.summary).toContain("$142.8B");
  expect(outcome.summary).toContain("$118.2B");
  expect(outcome.summary).not.toMatch(/\$\d+\.\s/);
  // Still trimmed to whole sentences within the feed's budget.
  expect(outcome.summary.split(/\s+/).length).toBeLessThanOrEqual(40);
  expect(outcome.summary.endsWith(".")).toBe(true);
});

/**
 * Every string below is a real finish from this deployment's own run history,
 * copied out of socialtrading_agent_runs. The agent was asked for SILENT and
 * told not to list what it checked; it did this instead, on every run.
 */
describe("check-reports never reach the feed", () => {
  const selfReports = [
    "I checked the latest news and price changes for Apple, Nvidia, Tesla, and Enphase Energy, all relevant to your Energy and Consumer themes.",
    "I checked the latest news and price updates for Apple, Nvidia, Tesla, and Enphase Energy relevant to your Energy and Consumer themes.",
    "I checked recent news and price changes for Apple, Nvidia, Tesla, Enphase Energy, and NextEra Energy, all relevant to your Energy and Consumer themes.",
    "No significant new developments or unusual news have appeared for Apple, Nvidia, Tesla, Enphase Energy, or ExxonMobil that would materially change the outlook on your Energy and Consumer themes right now.",
    "Checked recent news and price changes for Apple, Nvidia, Tesla, and Enphase Energy. No new significant developments or unusual price moves that would matter to you.",
    "No new significant developments or unusual price moves for Apple, Nvidia, Tesla or Enphase Energy today.",
    // A provider outage is an operational fact, not news. Real, from 18:10:27.
    "I attempted to retrieve the latest market data and news for Apple, Nvidia, Tesla, and Enphase Energy, but the market data service is currently busy and temporarily unavailable.",
    "Unable to reach the market data service this time; prices are unavailable.",
  ];
  const findings = [
    "Latest news relevant to your Energy and Consumer themes shows Tesla securing a 50% tax break for a $10 billion solar factory in Texas, supporting its robotaxi and energy storage ambitions.",
    "Apple reported the largest quarterly beat in corporate history with revenue of $142.8B versus $118.2B expected and EPS of $3.91 versus $2.44.",
    "Bought $3 of AAPLc for you under your limits. Apple reported its largest quarterly beat ever.",
    "Nokia is adopting Nvidia’s AI platform for mobile networks, expanding beyond data centers.",
  ];
  it.each(selfReports)("drops: %s", text => expect(isCheckReport(text)).toBe(true));
  it.each(findings)("keeps: %s", text => expect(isCheckReport(text)).toBe(false));

  it("leaves the feed empty rather than filling it with what the agent looked at", async () => {
    const model = scriptedModel([
      { toolCalls: [call("get_asset", { id: "VRT", kind: "stock" })] },
      { toolCalls: [call("remember", { notes: ["Checked VRT and CEG; quiet."] })] },
      { content: selfReports[0] },
    ]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.summary).toBe("");
    // The private detail survives where it belongs.
    expect((await store.readMemory(USER, "agent-a")).notes).toEqual(["Checked VRT and CEG; quiet."]);
    expect(outcome.decision?.inspected).toEqual(["get_asset(VRT)"]);
  });

  it("falls back to the finding it reached out about rather than to silence", async () => {
    const model = scriptedModel([
      { toolCalls: [call("notify_user", { title: "Tesla lands a $10B Texas solar plant", message: "Tesla secured a 50% tax break for a $10 billion solar factory in Texas.", relevance: "high", dedupe_key: "tsla-texas-2026-09" })] },
      { content: selfReports[3] },
    ]);
    const outcome = await runBackgroundAgent(job, deps(model));
    expect(outcome.summary).toBe("Tesla lands a $10B Texas solar plant");
  });

  it("still discloses a purchase when the model finishes with a check-report", async () => {
    const buy = async () => ({ result: { bought: true, symbol: "AAPLc", usd: "3", status: "confirmed" }, parts: [] });
    const registry = new CapabilityRegistry([
      { id: "trading", tools: [{ schema: { type: "function", function: { name: "buy_asset", description: "", parameters: {} } }, execute: buy }] },
      { id: "market", tools: [] }, { id: "profile", tools: [] },
    ]);
    const model = scriptedModel([
      { toolCalls: [call("buy_asset", { symbol: "AAPLc", usd: "3", reasoning: "Huge beat." })] },
      { content: selfReports[0] },
    ]);
    const outcome = await runBackgroundAgent(job, { ...deps(model), registry, buyUnattended: async () => ({ allowed: true, reason: "", wallet: "0xf212" }) });
    // Spending money is never silent, whatever the model wrote.
    expect(outcome.summary).toBe("Bought $3 of AAPLc for you under your limits.");
  });
});

it("honours SILENT at the end of a paragraph, and remembers the prose around it", async () => {
  // Real, from the 18:10:27 run: the model signalled silence the way it usually
  // does — a paragraph with the token tacked on — and an exact match missed it.
  const finish = "I attempted to retrieve the latest market data for Apple and Nvidia, but the service is busy. I will try again later. For now, there is no new information to report. SILENT.";
  const model = scriptedModel([{ toolCalls: [call("remember", { notes: ["Data provider was down."] })] }, { content: finish }]);
  const outcome = await runBackgroundAgent(job, deps(model));
  expect(outcome.summary).toBe("");
  // The reason it stayed quiet is carried into the next wake-up.
  expect((await store.readMemory(USER, "agent-a")).lastSummary).toBe(finish.replace(" SILENT.", ""));
});

it("still treats a bare SILENT as silence and remembers nothing from it", async () => {
  const model = scriptedModel([{ content: "SILENT" }]);
  const outcome = await runBackgroundAgent(job, deps(model));
  expect(outcome.summary).toBe("");
  expect((await store.readMemory(USER, "agent-a")).lastSummary).toBe("");
});

it("records tool failures on the run, so a quiet failure is findable afterwards", async () => {
  const boom = new CapabilityRegistry([
    { id: "market", tools: [{ schema: { type: "function", function: { name: "get_asset", description: "", parameters: {} } },
      execute: async () => { throw new Error("Market data is busy. Try again shortly."); } }] },
    { id: "trading", tools: [] }, { id: "profile", tools: [] },
  ]);
  const model = scriptedModel([{ toolCalls: [call("get_asset", { id: "AAPL" })] }, { content: "SILENT" }]);
  const outcome = await runBackgroundAgent(job, { ...deps(model), registry: boom });
  expect(outcome.status).toBe("succeeded");
  expect(outcome.decision?.failures).toEqual(["get_asset: Market data is busy. Try again shortly."]);
});
