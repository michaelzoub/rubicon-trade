import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAccountCalls, encodeAccountCalls, erc20ApproveData, PERMIT2, permit2ApproveData } from "./aa";
import { buildSwapBatch } from "./batch";
import type { SwapRequest, Transaction } from "./types";

const wallet = "0x1111111111111111111111111111111111111111";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const token = "0x3333333333333333333333333333333333333333";
const router = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const req: SwapRequest = { chainId: 8453, wallet, tokenIn: usdc, tokenOut: token, amount: "50000000", slippageBps: 50 };
const swap: Transaction = { chainId: 8453, from: wallet, to: router, data: "0x3593564c", value: "0" };

const word = (n: bigint | number) => BigInt(n).toString(16).padStart(64, "0");
/** eth_call answers, in the order buildSwapBatch asks: ERC20 allowance, then Permit2's. */
const reads = (erc20: bigint, permit2: { amount: bigint; expiration: number }) => vi.fn(async (_c: number, _m: string, params: unknown[]) => {
  const to = (params[0] as { to: string }).to.toLowerCase();
  return to === PERMIT2 ? `0x${word(permit2.amount)}${word(permit2.expiration)}${word(0)}` : `0x${word(erc20)}`;
}) as never;

const future = Math.floor(Date.now() / 1000) + 3600;
beforeEach(() => vi.useRealTimers());

describe("swap batch", () => {
  it("grants both Permit2 layers then swaps, for a wallet that has never traded", async () => {
    const batch = await buildSwapBatch(req, swap, reads(0n, { amount: 0n, expiration: 0 }));
    expect(batch.calls).toHaveLength(3);
    expect(batch.calls[0]).toMatchObject({ to: usdc, data: erc20ApproveData(PERMIT2, 50_000_000n) });
    expect(batch.calls[1].to).toBe(PERMIT2);
    expect(batch.calls[2]).toMatchObject({ to: router, data: swap.data, value: "0" });
    expect(batch.paymaster).toBe("circle-usdc");
  });

  it("approves only the amount being spent, never an unlimited allowance", async () => {
    const batch = await buildSwapBatch(req, swap, reads(0n, { amount: 0n, expiration: 0 }));
    expect(batch.calls[0].data).toBe(erc20ApproveData(PERMIT2, BigInt(req.amount)));
    expect(batch.calls[0].data).not.toContain("f".repeat(40));
  });

  // USDT and friends revert when an allowance moves non-zero to non-zero.
  it("clears a stale partial allowance before setting the new one", async () => {
    const batch = await buildSwapBatch(req, swap, reads(1n, { amount: 0n, expiration: 0 }));
    expect(batch.calls).toHaveLength(4);
    expect(batch.calls[0].data).toBe(erc20ApproveData(PERMIT2, 0n));
    expect(batch.calls[1].data).toBe(erc20ApproveData(PERMIT2, 50_000_000n));
  });

  it("skips allowances that are already sufficient and unexpired", async () => {
    const batch = await buildSwapBatch(req, swap, reads(100_000_000n, { amount: 100_000_000n, expiration: future }));
    expect(batch.calls).toHaveLength(1);
    expect(batch.calls[0].to).toBe(router);
  });

  it("re-grants a Permit2 allowance that is large enough but has expired", async () => {
    const batch = await buildSwapBatch(req, swap, reads(100_000_000n, { amount: 100_000_000n, expiration: 1 }));
    expect(batch.calls.map(c => c.to)).toEqual([PERMIT2, router]);
  });

  it("needs no allowance at all when paying with the chain's native token", async () => {
    const read = vi.fn() as never;
    const native = { ...req, tokenIn: "0x0000000000000000000000000000000000000000" };
    const batch = await buildSwapBatch(native, { ...swap, value: "0x2386f26fc10000" }, read);
    expect(batch.calls).toEqual([{ to: router, value: "10000000000000000", data: swap.data }]);
    expect(read).not.toHaveBeenCalled();
  });

  it("publishes calldata that decodes back to exactly the calls it authorized", async () => {
    const batch = await buildSwapBatch(req, swap, reads(0n, { amount: 0n, expiration: 0 }));
    expect(batch.callData).toBe(encodeAccountCalls(batch.calls));
    expect(decodeAccountCalls(batch.callData)).toEqual(batch.calls);
  });

  it("uses the router from the quote as the Permit2 spender, never a fixed address", async () => {
    const other = "0x2626664c2603336e57b271c5c0b26f421741e481";
    const batch = await buildSwapBatch(req, { ...swap, to: other }, reads(0n, { amount: 0n, expiration: 0 }));
    const expiration = Number(`0x${batch.calls[1].data.slice(-64)}`);
    expect(batch.calls[1].data).toBe(permit2ApproveData(usdc, other, 50_000_000n, expiration));
  });
});
