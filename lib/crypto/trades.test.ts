import { beforeEach, describe, expect, it, vi } from "vitest";
import { newProfile } from "@/lib/socialtrading/profile";
import { tradePolicy } from "@/lib/socialtrading/policy";
import type { HubState } from "@/lib/socialtrading/types";
const mocks = vi.hoisted(() => ({ ownedWallet: vi.fn(), quote: vi.fn(), value: vi.fn(), approval: vi.fn(), swap: vi.fn(), rpc: vi.fn(), price: vi.fn(), contract: vi.fn() }));
vi.mock("./wallet", () => ({ ownedWallet: mocks.ownedWallet }));
vi.mock("./services", () => ({ cryptoServices: { execution: { quote: mocks.quote, approval: mocks.approval, swap: mocks.swap }, valuation: { value: mocks.value }, defi: { price: mocks.price }, metadata: { contract: mocks.contract } } }));
vi.mock("./rpc", () => ({ rpc: mocks.rpc }));
import { proposeSwap, prepareSwap, authorizeSwap, userSwap } from "./trades";
import { encodeAccountCalls } from "./aa";
import { gaslessChain } from "./chains";
// Agent purchases settle on Base, so the fixtures are Base.
const req = { chainId: 8453, wallet: "0x1111111111111111111111111111111111111111", tokenIn: "0x2222222222222222222222222222222222222222", tokenOut: "0x3333333333333333333333333333333333333333", amount: "1000000", slippageBps: 50 };
const hex = (text: string) => [...text].map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
/** `symbol()` as the ABI returns it: offset, length, then the padded bytes. */
const abiString = (text: string) => `0x${(32n).toString(16).padStart(64, "0")}${BigInt(text.length).toString(16).padStart(64, "0")}${hex(text).padEnd(64, "0")}`;
function state(permission: "automatic" | "approve" | "notify" = "approve"): HubState { return { revision: 0, profile: { ...newProfile("alice"), permission, permissionConfigured: true, limits: { perTrade: "100", daily: "100", weekly: "100" } }, trades: [], messages: [], events: [], dislikes: [], preferences: [], inferred: [], signals: [] }; }
beforeEach(() => {
  vi.resetAllMocks(); mocks.ownedWallet.mockResolvedValue(req.wallet); mocks.value.mockResolvedValue(50); mocks.rpc.mockImplementation(async (_chain, method, params) => {
    if (method === "eth_getCode") return params[0] === req.wallet ? "0x" : "0x6000";
    if (method === "eth_call" && params.length === 3) return "0x";
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_estimateGas") return "0x186a0";
    if (method === "eth_gasPrice") return "0x1";
    if (params?.[0]?.data === "0x313ce567") return `0x${(params[0].to === req.tokenIn ? 6 : 18).toString(16).padStart(64, "0")}`;
    // symbol(), ABI-encoded: offset, length, then the bytes. A token's own
    // ticker is what the card prints, so the fixture has to speak it.
    if (params?.[0]?.data === "0x95d89b41") return abiString(params[0].to === req.tokenIn ? "USDC" : "wxyz");
    return `0x${(10n ** 25n).toString(16).padStart(64, "0")}`;
  });
  mocks.quote.mockResolvedValue({ outputAmount: "200", minimumOutput: "199", expiresAt: Date.now() + 60_000, request: req, raw: {} });
  mocks.approval.mockResolvedValue(null); mocks.swap.mockResolvedValue({ chainId: 8453, from: req.wallet, to: req.tokenOut, data: "0x1234", value: "0" });
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
  const input = { chainId: 8453, wallet: req.wallet, tokenIn: req.tokenIn, tokenOut: req.tokenOut, amount: "1.5" };
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

describe("gas sponsorship", () => {
  it("issues one sponsored batch instead of a transaction the wallet must fund", async () => {
    expect(gaslessChain(req.chainId)).toBe(true);
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    const prepared = await prepareSwap(s, "alice", t);
    // No separate approval to fund and sign first: it rides inside the batch.
    expect(prepared.transaction).toBeUndefined();
    expect(mocks.approval).not.toHaveBeenCalled();
    const authorized = await authorizeSwap(s, "alice", t, prepared.quoteId);
    const batch = authorized.batch!;
    expect(batch.paymaster).toBe("circle-usdc");
    expect(batch.sender).toBe(req.wallet);
    expect(authorized.transaction).toBeUndefined();
    // What the chain is later held to is what was authorized here.
    expect(batch.callData).toBe(encodeAccountCalls(batch.calls));
    expect(batch.calls.at(-1)).toMatchObject({ to: req.tokenOut, data: "0x1234" });
    expect(t.crypto?.batch).toEqual(batch);
    expect(t.crypto?.transaction).toBeUndefined();
    expect(t.crypto?.userOpHash).toBeUndefined();
  });
  it("never asks a sponsored wallet for native gas", async () => {
    const s = state(), t = await proposeSwap(s, "alice", req, "test");
    // An empty ETH balance is exactly the case sponsorship exists for.
    mocks.rpc.mockImplementation(async (_chain: number, method: string, params?: any[]) => {
      if (method === "eth_getCode") return params?.[0] === req.wallet ? "0x" : "0x6000";
      if (method === "eth_call" && params?.length === 3) return "0x";
      if (method === "eth_chainId") return "0x2105";
      if (method === "eth_getBalance") return "0x0";
      if (params?.[0]?.data === "0x313ce567") return `0x${(params[0].to === req.tokenIn ? 6 : 18).toString(16).padStart(64, "0")}`;
      return `0x${(10n ** 25n).toString(16).padStart(64, "0")}`;
    });
    const prepared = await prepareSwap(s, "alice", t);
    await expect(authorizeSwap(s, "alice", t, prepared.quoteId)).resolves.toMatchObject({ step: "swap" });
    expect(t.crypto?.batch?.paymaster).toBe("circle-usdc");
  });
});

it("refuses an agent proposal on any network but Base", async () => {
  // A scheduled run has nobody to correct it, so the rule lives in the code
  // rather than the prompt.
  const s = state("automatic");
  await expect(proposeSwap(s, "alice", { ...req, chainId: 42161 }, "why")).rejects.toThrow("Rubicon buys on Base");
  expect(s.trades).toHaveLength(0);
  await expect(proposeSwap(s, "alice", req, "why")).resolves.toBeDefined();
  expect(s.trades).toHaveLength(1);
});

/** A buy confirmation prints a quantity. Getting the decimal point wrong there
 * is not a cosmetic bug: 227373 and 0.00227373 are the same trade described
 * eight orders of magnitude apart, and the person signs based on what it says. */
describe("what a token is, for the card that asks you to sign", () => {
  // NVDAc, pinned in the catalog at 8 decimals.
  const nvda = "0xb20000000000000000000078ee7ce2fe4908108c";
  const pinned = { ...req, chainId: 8453, tokenOut: nvda };

  it("keeps a pinned token's symbol and decimals when no fresh price exists", async () => {
    // DefiLlama rejects a tokenized stock whose oracle last posted more than
    // five minutes ago — which is most of the day, once its market closes.
    mocks.price.mockImplementation(async (t: { address: string }) => {
      if (t.address === nvda) throw new Error("A fresh, reliable USD valuation is unavailable for this token.");
      return { symbol: "USDC", decimals: 6, price: 1, timestamp: Date.now() / 1000 };
    });
    const trade = await proposeSwap(state("automatic"), "alice", pinned, "test");
    expect(trade.crypto?.display.tokenOut).toEqual({ symbol: "NVDAc", decimals: 8 });
  });

  it("reads an unpinned token off the chain rather than calling it “token”", async () => {
    mocks.price.mockRejectedValue(new Error("A fresh, reliable USD valuation is unavailable for this token."));
    mocks.rpc.mockImplementation(async (_chain: number, method: string, params: { to: string; data: string }[]) => {
      if (method === "eth_chainId") return "0x2105";
      if (params?.[0]?.data === "0x313ce567") return `0x${(params[0].to === req.tokenIn ? 6 : 9).toString(16).padStart(64, "0")}`;
      // symbol() returns an ABI-encoded string: offset, length, then the bytes.
      if (params?.[0]?.data === "0x95d89b41") return abiString("MOON");
      return `0x${(10n ** 25n).toString(16).padStart(64, "0")}`;
    });
    const trade = await proposeSwap(state("automatic"), "alice", req, "test");
    expect(trade.crypto?.display.tokenOut).toEqual({ symbol: "MOON", decimals: 9 });
  });

  it("never reports decimals it could not establish", async () => {
    mocks.price.mockRejectedValue(new Error("unavailable"));
    mocks.rpc.mockImplementation(async (_chain: number, method: string) => {
      if (method === "eth_chainId") return "0x2105";
      throw new Error("Chain RPC rate limit reached; retry later (429).");
    });
    const trade = await proposeSwap(state("automatic"), "alice", req, "test");
    // Unknown is allowed to be unknown. Inventing 18 would misplace the point
    // just as badly as printing base units, only less visibly.
    expect(trade.crypto?.display.tokenOut.decimals).toBeNull();
  });
});

it("prepares a USDC-fee purchase without a separate Permit2 signature and simulates before issuing", async () => {
  const s = state();
  mocks.quote.mockResolvedValue({ outputAmount: "200", minimumOutput: "199", expiresAt: Date.now() + 60_000, request: req, raw: {}, permitData: { domain: { name: "Permit2" } } });
  const t = await userSwap(s, "alice", { ...req, amount: "0.6" });
  const prepared = await prepareSwap(s, "alice", t);
  expect(prepared.permitData).toBeUndefined();
  const result = await authorizeSwap(s, "alice", t, prepared.quoteId);
  expect(result.batch).toBeDefined();
  expect(mocks.swap).toHaveBeenCalledWith(expect.anything(), undefined, { batchedApprovals: true });
  expect(mocks.rpc).toHaveBeenCalledWith(8453, "eth_call", [expect.objectContaining({ to: req.wallet, data: result.batch!.callData }), "latest", expect.anything()]);
  expect(t.crypto?.phase).toBe("issued");
});

it("keeps a purchase unissued when its complete batch reverts", async () => {
  const s = state(), t = await userSwap(s, "alice", { ...req, amount: "0.6" });
  const prepared = await prepareSwap(s, "alice", t);
  const original = mocks.rpc.getMockImplementation()!;
  mocks.rpc.mockImplementation(async (...args) => {
    if (args[1] === "eth_call" && args[2].length === 3) throw new Error("execution reverted");
    return original(...args);
  });
  await expect(authorizeSwap(s, "alice", t, prepared.quoteId)).rejects.toThrow("Purchase simulation failed");
  expect(t.crypto?.phase).toBe("authorizing");
  expect(t.crypto?.batch).toBeUndefined();
});
