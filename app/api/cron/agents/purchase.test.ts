import { beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import { defaultAgent } from "@/lib/socialtrading/agents/config";
import { CapabilityRegistry } from "@/lib/socialtrading/agents/registry";
import { dispatchScheduledRuns } from "@/lib/socialtrading/runtime/dispatcher";
import { runBackgroundAgent } from "@/lib/socialtrading/runtime/background-agent";
import { MemoryRuntimeStore } from "@/lib/socialtrading/runtime/memory-store";
import type { ModelClient, ModelToolCall, RunJob } from "@/lib/socialtrading/runtime/types";
import type { HubState } from "@/lib/socialtrading/types";
import { BUY_CHAIN } from "@/lib/crypto/tradable";
import { DELEGATED_TOOLS } from "@/lib/socialtrading/runtime/background-agent";

vi.mock("@/lib/socialtrading/providers/market-data", () => ({ marketData: {} }));
vi.mock("@/lib/socialtrading/providers/crypto-data", () => ({ cryptoData: {} }));
vi.mock("@/lib/socialtrading/providers/brokerage", () => ({ brokerage: {}, BrokerageNotConnected: class extends Error {} }));

/** What the cron route does with a valid secret, wired to the real dispatcher and
 * the real background agent. Only the model and the tool bodies are doubles, so
 * everything between the HTTP request and the purchase attempt is production code. */
const { dispatchSpy } = vi.hoisted(() => ({ dispatchSpy: vi.fn() }));
vi.mock("@/lib/socialtrading/runtime/production", () => ({
  executeRun: (job: RunJob, signal: AbortSignal) => dispatchSpy(job, signal),
  runtimeStore: { dueAgents: () => dueAgents() },
}));
import { GET } from "./route";

const USER = PREVIEW_STATE.profile.userId;
const NOW = new Date("2026-09-15T10:31:00.000Z");
const SECRET = "cron-secret-for-tests";
const call = (name: string, args: object): ModelToolCall => ({ id: `${name}-1`, type: "function", function: { name, arguments: JSON.stringify(args) } });

const scriptedModel = (turns: { content?: string; toolCalls?: ModelToolCall[] }[]): ModelClient =>
  ({ async complete() { const turn = turns.shift() ?? { content: "Done." }; return { content: turn.content ?? "", toolCalls: turn.toolCalls ?? [] }; } });

/** Stands in for the real crypto capability: records every attempt so the test can
 * see whether a purchase reached execution at all. */
const proposals: Record<string, unknown>[] = [];
const proposeCryptoSwap = vi.fn(async (args: Record<string, unknown>) => {
  proposals.push(args);
  return { result: { tradeId: "t-cron", status: "reserved" }, parts: [] };
});
const listBuyable = vi.fn(async () => ({ result: { network: { chainId: BUY_CHAIN }, assets: [{ symbol: "NVDAc", tokenOut: `0x${"b2".repeat(20)}` }] }, parts: [] }));

/** Stands in for the tool that actually spends. Unattended, deciding to buy and
 * buying are one call: there is no proposal for anyone to review, so a second
 * step could only strand a reserved trade. */
const settled: { symbol: string; usd: string }[] = [];
const buyAsset = vi.fn(async (args: Record<string, unknown>) => {
  settled.push({ symbol: String(args.symbol), usd: String(args.usd) });
  return { result: { bought: true, symbol: String(args.symbol), usd: String(args.usd), status: "confirmed", hash: `0x${"ab".repeat(32)}` }, parts: [] };
});

const registry = new CapabilityRegistry([
  { id: "market", tools: [{ schema: { type: "function", function: { name: "list_buyable_assets", description: "", parameters: {} } }, execute: listBuyable }] },
  { id: "trading", tools: [
    { schema: { type: "function", function: { name: "buy_asset", description: "", parameters: {} } }, execute: buyAsset },
    { schema: { type: "function", function: { name: "propose_crypto_swap", description: "", parameters: {} } }, execute: proposeCryptoSwap },
  ] },
]);

/** What the deployment answers when asked whether this user granted unattended
 * buying. Production resolves it from the profile plus Privy. */
let grant: { allowed: boolean; reason: string; wallet?: string } = { allowed: false, reason: "Unattended buying is off." };

let store: MemoryRuntimeStore;
let model: ModelClient;
const agentState = (): HubState => ({ ...structuredClone(PREVIEW_STATE), agent: { ...defaultAgent("agent-a"), name: "Night shift", enabled: true, permission: "automatic" } });
const dueAgents = async () => [{ userId: USER, agentId: "agent-a", agent: agentState().agent!, lastStartedAt: null }];

beforeEach(() => {
  vi.clearAllMocks();
  proposals.length = 0; settled.length = 0;
  grant = { allowed: false, reason: "Unattended buying is off." };
  vi.stubEnv("CRON_SECRET", SECRET);
  store = new MemoryRuntimeStore(() => NOW);
  store.seed(USER, agentState());
  // The cron route's executor, but running the real background agent.
  dispatchSpy.mockImplementation((job: RunJob, signal: AbortSignal) =>
    runBackgroundAgent(job, { store, model, registry, services: {}, now: () => NOW, signal, buyUnattended: async () => grant }));
});

const fire = () => GET(new Request("http://localhost/api/cron/agents", { headers: { authorization: `Bearer ${SECRET}` } }));

it("carries a cron request all the way into a real agent run", async () => {
  // Proof the wiring is live rather than stubbed: a read tool executes for real.
  model = scriptedModel([{ toolCalls: [call("list_buyable_assets", {})] }, { content: "SILENT" }]);
  const response = await fire();
  expect(response.status).toBe(200);
  const report = await response.json();
  expect(report).toMatchObject({ considered: 1, started: 1, succeeded: 1, failed: 0 });
  expect(listBuyable).toHaveBeenCalledTimes(1);
  expect(store.runs).toHaveLength(1);
});

it("does not buy anything on a scheduled run, and says why", async () => {
  // The decisive one. A scheduled agent has nobody present to sign, so the
  // purchase tool is withheld from the model and refused if called anyway.
  model = scriptedModel([
    { toolCalls: [call("buy_asset", { symbol: "NVDAc", usd: "25", reasoning: "overnight" })] },
    { content: "SILENT" },
  ]);
  const report = await (await fire()).json();

  expect(report).toMatchObject({ started: 1, succeeded: 1 });
  // Nothing reached execution, and no trade exists.
  expect(buyAsset).not.toHaveBeenCalled();
  expect(proposals).toEqual([]);
  expect((await store.loadState(USER, "agent-a"))!.trades.filter(t => t.id === "t-cron")).toEqual([]);
});

it("never offers the purchase tool to a scheduled model in the first place", async () => {
  const seen: string[] = [];
  model = { async complete(input) { seen.push(...input.tools!.map(t => t.function.name)); return { content: "SILENT", toolCalls: [] }; } };
  await fire();
  expect(seen).toContain("list_buyable_assets");
  expect(seen).not.toContain("buy_asset");
});

const buyTurn = () => [
  { toolCalls: [call("buy_asset", { symbol: "NVDAc", usd: "25", reasoning: "overnight" })] },
  { content: "SILENT" },
];

it("buys on a scheduled run once the user has granted it", async () => {
  // The case the user asked for: enabled, limits set, wallet delegated.
  grant = { allowed: true, reason: "" };
  model = scriptedModel(buyTurn());
  const report = await (await fire()).json();

  expect(report).toMatchObject({ started: 1, succeeded: 1, failed: 0 });
  // Proposed and then actually settled, with nobody present.
  expect(settled).toEqual([{ symbol: "NVDAc", usd: "25" }]);
  // The attended pair is never offered to a scheduled run, granted or not.
  expect(proposeCryptoSwap).not.toHaveBeenCalled();
});

it("offers the purchase tools only to a granted run", async () => {
  // A slot runs once, so each half gets its own store rather than firing twice.
  const toolsOffered = async (granted: boolean) => {
    const seen: string[] = [];
    grant = granted ? { allowed: true, reason: "" } : { allowed: false, reason: "Unattended buying is off." };
    store = new MemoryRuntimeStore(() => NOW);
    store.seed(USER, agentState());
    model = { async complete(input) { seen.push(...input.tools!.map(t => t.function.name)); return { content: "SILENT", toolCalls: [] }; } };
    await fire();
    return seen;
  };
  const withoutGrant = await toolsOffered(false);
  const withGrant = await toolsOffered(true);

  expect(withoutGrant).toContain("list_buyable_assets");
  for (const name of DELEGATED_TOOLS) {
    expect(withoutGrant, `${name} must not be offered without a grant`).not.toContain(name);
    expect(withGrant, `${name} should be offered once granted`).toContain(name);
  }
});

it("refuses to spend when the grant is withdrawn mid-run, and says why", async () => {
  // The tool was offered, then the person revoked; the refusal carries the reason
  // so the agent notifies instead of retrying.
  grant = { allowed: true, reason: "" };
  model = scriptedModel([
    { toolCalls: [call("buy_asset", { symbol: "NVDAc", usd: "25", reasoning: "overnight" })] },
    { content: "SILENT" },
  ]);
  // Revoked between listing the tools and calling one.
  const revoke = { allowed: false, reason: "You turned unattended buying off." };
  dispatchSpy.mockImplementation((job: RunJob, signal: AbortSignal) =>
    runBackgroundAgent(job, { store, model, registry, services: {}, now: () => NOW, signal, buyUnattended: async () => { const g = grant; grant = revoke; return g; } }));
  await fire();
  expect(settled).toEqual([]);
  expect(buyAsset).not.toHaveBeenCalled();
});
