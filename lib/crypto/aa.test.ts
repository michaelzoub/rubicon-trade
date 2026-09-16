import { describe, expect, it } from "vitest";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { toSimple7702SmartAccount } from "viem/account-abstraction";
import { decodeAccountCalls, encodeAccountCalls, erc20ApproveData, permit2ApproveData, PERMIT2, SIMPLE_7702_ACCOUNT } from "./aa";
import type { Call } from "./types";

const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const router = "0x6ff5693b99212da76ad316178a184ab56d299b43";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const single: Call[] = [{ to: usdc, value: "0", data: erc20ApproveData(PERMIT2, 50_000_000n) }];
const batch: Call[] = [...single,
  { to: PERMIT2, value: "0", data: permit2ApproveData(usdc, router, 50_000_000n, 1893456000) },
  { to: router, value: "0", data: "0x3593564c" }];

async function viemAccount() {
  return toSimple7702SmartAccount({ client: createPublicClient({ chain: base, transport: http("https://unused.invalid") }), owner });
}

describe("7702 account calldata", () => {
  // The server authorizes a batch by its calldata and later refuses any user
  // operation whose calldata differs. If our encoding ever drifted from the one
  // the browser actually signs, every swap would fail verification — or worse,
  // a batch the server never saw would pass. Pin it to viem directly.
  it("encodes single and batched calls byte-for-byte like viem's 7702 account", async () => {
    const account = await viemAccount();
    for (const calls of [single, batch]) {
      const expected = await account.encodeCalls(calls.map(c => ({ to: c.to as `0x${string}`, value: BigInt(c.value), data: c.data as `0x${string}` })));
      expect(encodeAccountCalls(calls)).toBe(expected);
    }
  });

  it("uses the same delegate implementation address viem authorizes", async () => {
    const account = await viemAccount();
    expect(account.authorization?.address.toLowerCase()).toBe(SIMPLE_7702_ACCOUNT);
  });

  it("round-trips calls so an onchain user operation can be matched against the authorized batch", () => {
    expect(decodeAccountCalls(encodeAccountCalls(batch))).toEqual(batch.map(c => ({ ...c, to: c.to.toLowerCase(), data: c.data.toLowerCase() })));
    expect(decodeAccountCalls(encodeAccountCalls(single))).toEqual(single);
  });

  it("refuses to encode an empty batch rather than authorizing a no-op signature", () => {
    expect(() => encodeAccountCalls([])).toThrow(/at least one call/);
  });
});
