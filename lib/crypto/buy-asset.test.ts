// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { PREVIEW_STATE } from "@/app/preview/fixture";
import type { HubState } from "@/lib/socialtrading/types";

const WALLET = "0xf21219da75e62254aab31ba7c919dd3bd9621790";
/** Balance the fake chain reports, in USDC base units. */
let balance = 3_454_757n;
const proposed: { amount: string }[] = [];
let settledStatus: "confirmed" | "failed" | "unknown" = "confirmed";

vi.mock("./wallet", () => ({
  firstDelegatedWallet: async () => ({ id: "signer-1", address: WALLET }),
  delegatedWallet: async () => ({ id: "signer-1", address: WALLET }),
  userWallets: async () => [WALLET],
  ownedWallet: async () => undefined,
}));
/** Swappable so a test can make the chain misbehave. */
let rpcCall: (chainId: number, method: string, params: unknown[]) => Promise<unknown> =
  async (_chain, method) => {
    if (method === "eth_call") return `0x${balance.toString(16).padStart(64, "0")}`;
    throw new Error(`unexpected rpc ${method}`);
  };
vi.mock("./rpc", () => ({ rpc: (...args: [number, string, unknown[]]) => rpcCall(...args) }));
vi.mock("./trades", () => ({
  proposeSwap: async (_s: unknown, _u: string, req: { amount: string }) => {
    proposed.push({ amount: req.amount });
    return { id: "t-1", status: "reserved", value: Number(req.amount) / 1e6, asset: { symbol: "AAPLc" }, crypto: { request: req } };
  },
}));
vi.mock("./autonomous", () => ({
  autonomyState: () => ({ allowed: true, reason: "" }),
  executeAutonomousBuy: async () => ({ hash: "0xabc", userOpHash: "0xdef", status: settledStatus }),
}));

const { executeCryptoTool } = await import("./agent");
const context = () => ({ userId: "u", agentId: "default", state: structuredClone(PREVIEW_STATE) as HubState, services: {}, limits: {} } as never);
const buy = (args: Record<string, unknown>) => executeCryptoTool("buy_asset", args, context());

beforeEach(() => { proposed.length = 0; balance = 3_454_757n; settledStatus = "confirmed"; });

it("keeps $0.60 of USDC back and shrinks the purchase to fit", async () => {
  // The real case: $3.45 in the wallet, the agent asks for its $3 per-trade cap.
  const { result } = await buy({ symbol: "AAPLc", usd: "3", reasoning: "Huge beat." }) as { result: Record<string, unknown> };
  expect(proposed).toEqual([{ amount: "2854757" }]);
  expect(result.bought).toBe(true);
  expect(result.usd).toBe("2.85");
  expect(result.note).toContain("Asked for $3; spent $2.85");
  // Exactly the holdback is left behind.
  expect(balance - BigInt(proposed[0].amount)).toBe(600_000n);
});

it("spends the full amount when the balance leaves room", async () => {
  balance = 10_000_000n;
  const { result } = await buy({ symbol: "AAPLc", usd: "3", reasoning: "Huge beat." }) as { result: Record<string, unknown> };
  expect(proposed).toEqual([{ amount: "3000000" }]);
  expect(result.usd).toBe("3.00");
  expect(result.note).toBeUndefined();
});

it("refuses when the balance cannot cover the fee at all", async () => {
  balance = 550_000n;
  await expect(buy({ symbol: "AAPLc", usd: "3", reasoning: "Huge beat." })).rejects.toThrow(/0\.55 of USDC.*0\.60 has to stay behind/s);
  expect(proposed).toEqual([]);
});

it("reads the amount whatever shape the model sends it in", async () => {
  balance = 10_000_000n;
  for (const [sent, expected] of [[3, "3000000"], ["$2.50", "2500000"], ["2 USD", "2000000"], ["1,000", "9400000"]] as const) {
    proposed.length = 0;
    await buy({ symbol: "AAPLc", usd: sent, reasoning: "x" });
    expect(proposed[0].amount, `usd: ${JSON.stringify(sent)}`).toBe(expected);
  }
});

it("rejects an unreadable amount without proposing anything", async () => {
  await expect(buy({ symbol: "AAPLc", usd: "abc", reasoning: "x" })).rejects.toThrow(/Could not read "abc"/);
  await expect(buy({ symbol: "AAPLc", usd: 0, reasoning: "x" })).rejects.toThrow(/Could not read "0"/);
  expect(proposed).toEqual([]);
});

it("does not claim a purchase that has not confirmed", async () => {
  settledStatus = "unknown";
  const { result } = await buy({ symbol: "AAPLc", usd: "1", reasoning: "x" }) as { result: Record<string, unknown> };
  expect(result.bought).toBe(false);
  expect(result.instruction).toMatch(/Do not claim it succeeded/);
});

it("refuses a symbol Rubicon cannot buy, before touching the wallet", async () => {
  await expect(buy({ symbol: "DOGE", usd: "1", reasoning: "x" })).rejects.toThrow();
  expect(proposed).toEqual([]);
});

it("waits out a rate-limited balance read instead of failing the purchase", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const real = rpcCall;
  rpcCall = async (_c: number, method: string) => {
    if (method !== "eth_call") throw new Error("unexpected");
    if (++calls < 3) throw Object.assign(new Error("Chain RPC rate limit reached; retry later (429)."), { status: 429 });
    return `0x${balance.toString(16).padStart(64, "0")}`;
  };
  try {
    const pending = buy({ symbol: "AAPLc", usd: "3", reasoning: "x" }) as Promise<{ result: Record<string, unknown> }>;
    await vi.advanceTimersByTimeAsync(10_000);
    const { result } = await pending;
    expect(calls).toBe(3);
    expect(result.usd).toBe("2.85");
  } finally { rpcCall = real; vi.useRealTimers(); }
});

it("gives up on a rate-limited read with a plain reason, and buys nothing", async () => {
  vi.useFakeTimers();
  const real = rpcCall;
  rpcCall = async () => { throw Object.assign(new Error("Chain RPC rate limit reached; retry later (429)."), { status: 429 }); };
  try {
    const pending = buy({ symbol: "AAPLc", usd: "3", reasoning: "x" });
    const assertion = expect(pending).rejects.toThrow(/rate limiting reads right now.*Nothing was bought/s);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(proposed).toEqual([]);
  } finally { rpcCall = real; vi.useRealTimers(); }
});
