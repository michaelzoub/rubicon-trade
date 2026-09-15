import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProfile } from "./profile";
import type { Asset, HubState } from "./types";

const placeOrder = vi.hoisted(() => vi.fn());
vi.mock("./providers/brokerage", () => {
  class BrokerageNotConnected extends Error {}
  return { BrokerageNotConnected, brokerage: { provider: "robinhood", status: vi.fn(), placeOrder } };
});
vi.mock("./server", () => ({ HubError: class HubError extends Error { constructor(public status: number, message: string) { super(message); } }, database: vi.fn() }));
import { decideTrade, proposeTrade } from "./trades";
import { BrokerageNotConnected } from "./providers/brokerage";

function hub(permission: "notify" | "approve" | "automatic", limits = { perTrade: "", daily: "", weekly: "" }): HubState {
  return { revision: 0, profile: { ...newProfile("alice"), thesis: "Energy", themes: ["energy"], permission, permissionConfigured: true, limits, step: 5, completedAt: "2026-09-14T00:00:00Z" }, dislikes: [], preferences: [], inferred: [], signals: [], messages: [], events: [], trades: [] };
}
const quote: Asset = { id: "OKLO", symbol: "OKLO", name: "Oklo", kind: "stock", price: 50, change: 1, asOf: null, source: "Massive", themes: ["energy"], chart: [], news: [] };
const input = { asset: { id: "OKLO", symbol: "OKLO", name: "Oklo", kind: "stock" as const }, side: "buy" as const, value: 50, reasoning: "Fits the power thesis." };

describe("trade intents", () => {
  beforeEach(() => { placeOrder.mockReset(); });
  it("blocks in Notify mode and never contacts the brokerage", async () => {
    const state = hub("notify");
    const trade = await proposeTrade(state, "alice", input, quote);
    expect(trade.status).toBe("blocked");
    expect(placeOrder).not.toHaveBeenCalled();
    expect(state.events.at(-1)?.tradeId).toBe(trade.id);
  });
  it("waits for approval in Ask mode, then records that Robinhood is not connected", async () => {
    placeOrder.mockImplementation(() => { throw new BrokerageNotConnected(); });
    const state = hub("approve");
    const trade = await proposeTrade(state, "alice", input, quote);
    expect(trade.status).toBe("approval_required");
    expect(trade.estimatedQuantity).toBe(1);
    expect(placeOrder).not.toHaveBeenCalled();
    await decideTrade(state, "alice", trade.id, "approved");
    expect(trade.approval?.decision).toBe("approved");
    expect(trade.status).toBe("reserved");
    expect(trade.brokerage?.status).toBe("not_connected");
    await expect(decideTrade(state, "alice", trade.id, "approved")).rejects.toThrow(/already/);
  });
  it("only confirms on an explicit fill and learns from rejections", async () => {
    placeOrder.mockResolvedValue({ status: "submitted", orderId: "rh-1" });
    const state = hub("automatic", { perTrade: "100", daily: "200", weekly: "500" });
    const trade = await proposeTrade(state, "alice", input, quote);
    expect(trade.status).toBe("submitted");
    expect(trade.brokerage?.orderId).toBe("rh-1");
    placeOrder.mockResolvedValue({ status: "filled", orderId: "rh-2" });
    expect((await proposeTrade(state, "alice", input, quote)).status).toBe("confirmed");
    expect((await proposeTrade(state, "alice", { ...input, value: 150 }, quote)).status).toBe("blocked");
    const ask = hub("approve");
    const pending = await proposeTrade(ask, "alice", input, quote);
    await decideTrade(ask, "alice", pending.id, "rejected");
    expect(pending.status).toBe("rejected");
    expect(ask.inferred.find(i => i.id === "OKLO")?.weight).toBeLessThan(0);
  });
});

it("does not let an additional agent inherit the default brokerage connection", async () => {
  placeOrder.mockReset();
  const state = hub("automatic", { perTrade: "100", daily: "200", weekly: "500" });
  state.agent = { id: "another-agent", name: "Research", description: "", instructions: "", capabilities: ["trading"], createdAt: "" };
  const trade = await proposeTrade(state, "alice", input, quote);
  expect(placeOrder).not.toHaveBeenCalled();
  expect(trade.brokerage?.status).toBe("not_connected");
});
