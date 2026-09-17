import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, pad } from "viem";
import { entryPoint08Abi } from "viem/account-abstraction";
import { ENTRY_POINT, encodeAccountCalls, erc20ApproveData, PERMIT2 } from "./aa";
import type { SwapBatch } from "./types";

const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock("./http", () => ({ http: mocks.http }));
import { verifyUserOperation } from "./rpc";

const sender = "0x1111111111111111111111111111111111111111";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const userOpHash = `0x${"ab".repeat(32)}`;
const txHash = `0x${"cd".repeat(32)}`;
const calls = [{ to: usdc, value: "0", data: erc20ApproveData(PERMIT2, 50_000_000n) }];
const batch: SwapBatch = { chainId: 8453, sender, calls, callData: encodeAccountCalls(calls), paymaster: "circle-usdc" };

const op = (over: Partial<{ sender: string; callData: string }> = {}) => ({
  sender: (over.sender ?? sender) as `0x${string}`, nonce: 0n, initCode: "0x" as const,
  callData: (over.callData ?? batch.callData) as `0x${string}`,
  accountGasLimits: pad("0x01"), preVerificationGas: 0n, gasFees: pad("0x01"),
  paymasterAndData: "0x" as const, signature: "0x" as const,
});
const bundle = (ops: ReturnType<typeof op>[]) => encodeFunctionData({ abi: entryPoint08Abi, functionName: "handleOps", args: [ops, sender as `0x${string}`] });
const event = (success: boolean, opHash = userOpHash, from = sender) => ({
  address: ENTRY_POINT,
  topics: encodeEventTopics({ abi: entryPoint08Abi, eventName: "UserOperationEvent", args: { userOpHash: opHash as `0x${string}`, sender: from as `0x${string}`, paymaster: PERMIT2 as `0x${string}` } }),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, success, 0n, 0n]),
});

/** One RPC script per test: the node answers in whatever order the verifier asks. */
function node({ input, logs, confirmations = 2 }: { input?: string; logs?: unknown[]; confirmations?: number } = {}) {
  mocks.http.mockImplementation(async (_p: string, _u: string, o: { body: { method: string } }) => {
    switch (o.body.method) {
      case "eth_chainId": return { result: "0x2105" };
      case "eth_getTransactionByHash": return { result: input === undefined ? null : { to: ENTRY_POINT, input } };
      case "eth_getTransactionReceipt": return { result: logs === undefined ? null : { blockNumber: "0x10", blockHash: "0xbeef", logs } };
      case "eth_getBlockByNumber": return { result: { hash: "0xbeef" } };
      case "eth_blockNumber": return { result: `0x${(0x10 + confirmations).toString(16)}` };
      default: return { result: null };
    }
  });
}

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRYPTO_RPC_URL_8453", "https://rpc.example.com"); });

describe("user operation verification", () => {
  it("confirms our operation even when the bundler mixed it with other people's", async () => {
    node({ input: bundle([op({ sender: "0x9999999999999999999999999999999999999999" }), op()]), logs: [event(false, `0x${"11".repeat(32)}`, "0x9999999999999999999999999999999999999999"), event(true)] });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("confirmed");
  });

  it("reports a failed operation as reverted rather than confirmed", async () => {
    node({ input: bundle([op()]), logs: [event(false)] });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("reverted");
  });

  // The whole point of pinning calldata: a client that signs a different batch
  // than the one the server priced and reserved must not be able to report it.
  it("refuses a bundle whose calldata is not the batch the server authorized", async () => {
    node({ input: bundle([op({ callData: encodeAccountCalls([{ to: usdc, value: "0", data: erc20ApproveData(PERMIT2, 999_000_000n) }]) })]), logs: [event(true)] });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).rejects.toThrow(/does not match/);
  });

  it("refuses an operation sent by a wallet other than the one that was authorized", async () => {
    node({ input: bundle([op({ sender: "0x9999999999999999999999999999999999999999" })]), logs: [event(true)] });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).rejects.toThrow(/does not match/);
  });

  it("refuses a transaction that never went through the EntryPoint", async () => {
    mocks.http.mockImplementation(async (_p: string, _u: string, o: { body: { method: string } }) =>
      o.body.method === "eth_chainId" ? { result: "0x2105" } : { result: { to: usdc, input: "0xdeadbeef" } });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).rejects.toThrow(/does not match/);
  });

  it("stays pending before the transaction is mined and before two confirmations", async () => {
    node({});
    await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("pending");
    node({ input: bundle([op()]), logs: [event(true)], confirmations: 1 });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("pending");
  });

  it("does not accept a success event belonging to a different user operation", async () => {
    node({ input: bundle([op()]), logs: [event(true, `0x${"ee".repeat(32)}`)] });
    await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("pending");
  });
});

describe("recovering a batch from a transaction hash alone", () => {
  it("identifies the operation by sender when the user pasted only the transaction hash", async () => {
    node({ input: bundle([op()]), logs: [event(true, `0x${"ee".repeat(32)}`)] });
    await expect(verifyUserOperation(batch, undefined, txHash)).resolves.toBe("confirmed");
  });

  it("declines to guess when the wallet sent two operations in the same bundle", async () => {
    node({ input: bundle([op(), op()]), logs: [event(true, `0x${"ee".repeat(32)}`), event(false, `0x${"ff".repeat(32)}`)] });
    await expect(verifyUserOperation(batch, undefined, txHash)).resolves.toBe("pending");
  });

  it("still refuses a bundle that never carried the authorized calldata", async () => {
    node({ input: bundle([op({ callData: "0xdeadbeef" })]), logs: [event(true, `0x${"ee".repeat(32)}`)] });
    await expect(verifyUserOperation(batch, undefined, txHash)).rejects.toThrow(/does not match/);
  });
});

it("does not mistake a different operation from the SAME wallet for the authorized purchase", async () => {
  const otherHash = `0x${"ef".repeat(32)}`;
  node({ input: bundle([op(), op({ callData: "0xdeadbeef" })]), logs: [event(false, userOpHash), event(true, otherHash)] });
  await expect(verifyUserOperation(batch, otherHash, txHash)).rejects.toThrow(/does not match/);
  await expect(verifyUserOperation(batch, userOpHash, txHash)).resolves.toBe("reverted");
});
