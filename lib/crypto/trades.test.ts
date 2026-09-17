import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProfile } from "@/lib/socialtrading/profile";
import { tradePolicy } from "@/lib/socialtrading/policy";
import type { HubState } from "@/lib/socialtrading/types";
const mocks = vi.hoisted(() => ({ ownedWallet: vi.fn(), quote: vi.fn(), value: vi.fn(), approval: vi.fn(), swap: vi.fn(), rpc: vi.fn(), price: vi.fn(), contract: vi.fn() }));
vi.mock("./wallet", () => ({ ownedWallet: mocks.ownedWallet }));
vi.mock("./services", () => ({ cryptoServices: { execution: { quote: mocks.quote, approval: mocks.approval, swap: mocks.swap }, valuation: { value: mocks.value }, defi: { price: mocks.price }, metadata: { contract: mocks.contract } } }));
vi.mock("./rpc", () => ({ rpc: mocks.rpc }));
import { proposeSwap, prepareSwap, authorizeSwap, userSwap } from "./trades";
const req = { chainId: 1, wallet: "0x1111111111111111111111111111111111111111", tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333", amount: "1000000", slippageBps: 50 };
function state(permission: "automatic" | "approve" | "notify" = "approve"): HubState { return { revision: 0, profile: { ...newProfile("alice"), permission, permissionConfigured: true, limits: { perTrade: "100", daily: "100", weekly: "100" } }, trades: [], messages: [], events: [], dislikes: [], preferences: [], inferred: [], signals: [] }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.ownedWallet.mockResolvedValue(req.wallet); mocks.value.mockResolvedValue(50); mocks.rpc.mockImplementation(async (_chain, method, params) => {
    if (method === "eth_chainId") return "0x1";
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_gasPrice") return "0x1";
    if (params?.[0]?.data === "0x313ce567") return `0x${(params[0].to === req.tokenIn ? 6 : 18).toString(16).padStart(64, "0")}`;
    return `0x${(10n ** 25n).toString(16).padStart(64, "0")}`;
  });
  mocks.quote.mockResolvedValue({ outputAmount: "200", minimumOutput: "199", expiresAt: Date.now() + 60_000, request: req, raw: {} });
  mocks.approval.mockResolvedValue(null); mocks.swap.mockResolvedValue({ chainId: 1, from: req.wallet, to: req.tokenOut, data: "0x1234", value: "0" });
  mocks.price.mockImplementation(async (t: { address: string }) => t.address === req.tokenIn ? { symbol: "USDC", decimals: 6, price: 1, timestamp: Date.now() / 1000 } : { symbol: "wxyz", decimals: 18, price: 2, timestamp: Date.now() / 1000 });
});
describe("agent swap proposals", () => {
  it("blocks Notify mode, waits for approval in Ask mode, and reserves in Act mode without executing", async () => {
    const notify = state("notify"), ask = state("approve"), auto = state("automatic");
    expect((await proposeSwap(notify, "alice", req, "test")).status).toBe("blocked");
    expect((await proposeSwap(ask, "alice", req, "test")).status).toBe("approval_required");
    const reserved = await proposeSwap(auto, "alice", req, "test");
    expect(reserved.status).toBe("reserved"); expect(reserved.initiator).toBe("agent"); expect(reserved.crypto?.phase).toBe("ready");
    expect(reserved.crypto?.display).toEqual({ tokenIn: { symbol: "USDC", decimals: 6 }, tokenOut: { symbol: "wxyz", decimals: 18 } });
    expect(reserved.asset.symbol).toBe("WXYZ");
    expect(mocks.swap).not.toHaveBeenCalled(); expect(mocks.approval).not.toHaveBeenCalled();
  });
  it("counts an Act-mode reservation against the agent's limits immediately", async () => {
    const auto = state("automatic");
    await proposeSwap(auto, "alice", req, "first");
    mocks.value.mockResolvedValue(60);
    const second = await proposeSwap(auto, "alice", req, "second");
    expect(second.status).toBe("blocked"); expect(second.policy.reason).toMatch(/24-hour/);
  });
  it("checks wallet ownership before requesting a quote", async () => {
    mocks.ownedWallet.mockRejectedValue(new Error("Not your wallet"));
    await expect(proposeSwap(state(), "alice", req, "test")).rejects.toThrow(/wallet/); expect(mocks.quote).not.toHaveBeenCalled();
  });
  it("reserves before signing and never reissues a transaction", async () => {
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    const prepared = await prepareSwap(s, "alice", t); await authorizeSwap(s, "alice", t, prepared.quoteId); expect(t.status).toBe("unknown"); expect(t.crypto?.phase).toBe("issued");
    await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/already/); expect(mocks.swap).toHaveBeenCalledTimes(1);
  });
  it("requires a new proposal after adverse price or valuation changes, or after a day", async () => {
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    mocks.value.mockResolvedValue(51); await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/USD/);
    mocks.value.mockResolvedValue(50); mocks.quote.mockResolvedValue({ minimumOutput: "198" });
    await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/minimum/); expect(mocks.swap).not.toHaveBeenCalled();
    t.createdAt = new Date(Date.now() - 25 * 3600_000).toISOString();
    await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/day old/);
  });
  it("rechecks current policy and keeps issued reservations counted in every limit window", async () => {
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    s.profile.permission = "notify"; await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/Notify/);
    s.profile.permission = "approve"; const prepared = await prepareSwap(s, "alice", t); await authorizeSwap(s, "alice", t, prepared.quoteId); t.createdAt = "2020-01-01T00:00:00Z";
    expect(tradePolicy(s.profile, 60, s.trades, true).allowed).toBe(false);
  });
  it("refuses to prepare an agent swap when the agent lost the trading capability", async () => {
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    s.agent = { id: "default", name: "A", description: "", capabilities: ["market"], createdAt: "" };
    await expect(prepareSwap(s, "alice", t)).rejects.toThrow(/disabled/);
  });
});
describe("user-initiated swaps", () => {
  const input = { chainId: 1, wallet: req.wallet, tokenIn: req.tokenIn, tokenOut: req.tokenOut, amount: "1.5" };
  it("converts human units exactly with provider decimals and is allowed in every agent mode", async () => {
    for (const mode of ["notify", "approve", "automatic"] as const) {
      const s = state(mode), t = await userSwap(s, "alice", input);
      expect(t.initiator).toBe("user"); expect(t.status).toBe("reserved"); expect(t.crypto?.request.amount).toBe("1500000");
      expect(t.policy.reason).toMatch(/yourself/);
    }
    expect(mocks.quote.mock.calls[0][0]).toMatchObject({ amount: "1500000", slippageBps: 50 });
  });
  it("does not consume the agent's allowance, and agent limits still bind the agent afterwards", async () => {
    const s = state("automatic");
    mocks.value.mockResolvedValue(95); await userSwap(s, "alice", input);
    mocks.value.mockResolvedValue(100); expect((await proposeSwap(s, "alice", req, "agent")).status).toBe("reserved");
    mocks.value.mockResolvedValue(1); expect((await proposeSwap(s, "alice", req, "agent")).status).toBe("blocked");
  });
  it("uses native and onchain decimals and refuses an unverifiable token", async () => {
    const s = state();
    expect((await userSwap(s, "alice", { ...input, tokenIn: "0x0000000000000000000000000000000000000000", amount: "0.25" })).crypto?.request.amount).toBe("250000000000000000");
    mocks.price.mockRejectedValue(new Error("down"));
    expect((await userSwap(s, "alice", { ...input, amount: "2" })).crypto?.request.amount).toBe("2000000");
    mocks.rpc.mockResolvedValue("0x");
    await expect(userSwap(s, "alice", input)).rejects.toThrow(/decimals/);
  });
  it("rejects malformed amounts, chains, and wallets before quoting", async () => {
    const s = state();
    await expect(userSwap(s, "alice", { ...input, amount: "1e18" })).rejects.toThrow(/amount/i);
    await expect(userSwap(s, "alice", { ...input, amount: "0" })).rejects.toThrow(/greater than zero/);
    await expect(userSwap(s, "alice", { ...input, amount: "1.1234567" })).rejects.toThrow(/decimal places/);
    await expect(userSwap(s, "alice", { ...input, chainId: 999 })).rejects.toThrow(/chain/i);
    await expect(userSwap(s, "alice", { ...input, wallet: "nope" })).rejects.toThrow(/address/);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it("lets the user prepare their swap even when the agent cannot trade", async () => {
    const s = state("notify"); s.agent = { id: "default", name: "A", description: "", capabilities: ["market"], createdAt: "" };
    const t = await userSwap(s, "alice", input);
    const prepared = await prepareSwap(s, "alice", t); await authorizeSwap(s, "alice", t, prepared.quoteId); expect(t.crypto?.phase).toBe("issued");
  });
});
