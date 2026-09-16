import "server-only";
import { chain } from "./chains";
import { http } from "./http";
import type { SwapBatch, Transaction } from "./types";
export async function rpc<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  chain(chainId); const url = process.env[`CRYPTO_RPC_URL_${chainId}`];
  if (!url || !url.startsWith("https://")) throw new Error(`Configure CRYPTO_RPC_URL_${chainId} for transaction verification.`);
  const result = await http<{ result: T; error?: unknown }>("Chain RPC", url, { body: { jsonrpc: "2.0", id: 1, method, params } });
  if (result.error || !("result" in result)) throw new Error("Chain RPC could not verify the transaction.");
  return result.result;
}
export async function verifyTransaction(tx: Transaction, hash: string): Promise<"pending" | "confirmed" | "reverted"> {
  const [network, sent, receipt] = await Promise.all([
    rpc<string>(tx.chainId, "eth_chainId", []),
    rpc<{ from: string; to: string; input: string; value: string } | null>(tx.chainId, "eth_getTransactionByHash", [hash]),
    rpc<{ status: string; blockNumber: string; blockHash: string } | null>(tx.chainId, "eth_getTransactionReceipt", [hash]),
  ]);
  if (BigInt(network) !== BigInt(tx.chainId)) throw new Error("RPC network mismatch.");
  if (!sent) return "pending";
  if (sent.from.toLowerCase() !== tx.from.toLowerCase() || sent.to?.toLowerCase() !== tx.to.toLowerCase() || sent.input.toLowerCase() !== tx.data.toLowerCase() || BigInt(sent.value) !== BigInt(tx.value)) throw new Error("Transaction hash does not match the authorized transaction.");
  if (!receipt) return "pending";
  if (!(await settled(tx.chainId, receipt))) return "pending";
  if (receipt.status !== "0x0" && receipt.status !== "0x1") throw new Error("Invalid transaction receipt.");
  return receipt.status === "0x1" ? "confirmed" : "reverted";
}

/** Two confirmations and a block-hash match, so a reorg cannot leave us reporting
 * a settled trade. Shared by the plain-transaction and user-operation paths. */
async function settled(chainId: number, receipt: { blockNumber: string; blockHash: string }): Promise<boolean> {
  const [block, head] = await Promise.all([
    rpc<{ hash: string } | null>(chainId, "eth_getBlockByNumber", [receipt.blockNumber, false]),
    rpc<string>(chainId, "eth_blockNumber", []),
  ]);
  return !!block && block.hash === receipt.blockHash && BigInt(head) - BigInt(receipt.blockNumber) >= BigInt(2);
}

/** Verify a batch that settled through ERC-4337 rather than as the user's own
 * transaction.
 *
 * The transaction onchain is the bundler's, not the user's: it calls the
 * EntryPoint with a bundle of other people's operations mixed in, so the
 * from/to/input equality the plain path relies on cannot hold. What still holds
 * is the calldata. We pull every operation out of the bundle, demand one sent by
 * this wallet carrying byte-for-byte the calldata the server authorized, and only
 * then read that operation's own success flag. A bundle containing someone
 * else's failure, or a batch we never authorized, never reads as confirmed. */
export async function verifyUserOperation(batch: SwapBatch, userOpHash: string | undefined, hash: string): Promise<"pending" | "confirmed" | "reverted"> {
  const { decodeFunctionData, decodeEventLog } = await import("viem");
  const { entryPoint08Abi } = await import("viem/account-abstraction");
  const { ENTRY_POINT } = await import("./aa");

  const [network, sent] = await Promise.all([
    rpc<string>(batch.chainId, "eth_chainId", []),
    rpc<{ to: string | null; input: string } | null>(batch.chainId, "eth_getTransactionByHash", [hash]),
  ]);
  if (BigInt(network) !== BigInt(batch.chainId)) throw new Error("RPC network mismatch.");
  if (!sent) return "pending";
  if (sent.to?.toLowerCase() !== ENTRY_POINT) throw new Error("Transaction hash does not match the authorized transaction.");

  let decoded: { functionName: string; args: readonly unknown[] };
  try { decoded = decodeFunctionData({ abi: entryPoint08Abi, data: sent.input as `0x${string}` }); }
  catch { throw new Error("Transaction hash does not match the authorized transaction."); }
  type Packed = { sender: string; callData: string };
  const ops: Packed[] = decoded.functionName === "handleOps" ? (decoded.args[0] as Packed[])
    : decoded.functionName === "handleAggregatedOps" ? (decoded.args[0] as { userOps: Packed[] }[]).flatMap(a => a.userOps)
    : [];
  if (!ops.some(op => op.sender.toLowerCase() === batch.sender && op.callData.toLowerCase() === batch.callData.toLowerCase()))
    throw new Error("Transaction hash does not match the authorized transaction.");

  const receipt = await rpc<{ blockNumber: string; blockHash: string; logs?: { address: string; topics: string[]; data: string }[] } | null>(batch.chainId, "eth_getTransactionReceipt", [hash]);
  if (!receipt) return "pending";
  if (!(await settled(batch.chainId, receipt))) return "pending";

  const events: { hash: string; sender: string; success: boolean }[] = [];
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== ENTRY_POINT) continue;
    let event: { eventName: string; args: Record<string, unknown> };
    try { event = decodeEventLog({ abi: entryPoint08Abi, topics: log.topics as [`0x${string}`, ...`0x${string}`[]], data: log.data as `0x${string}` }) as typeof event; }
    catch { continue; }
    if (event.eventName === "UserOperationEvent")
      events.push({ hash: String(event.args.userOpHash).toLowerCase(), sender: String(event.args.sender).toLowerCase(), success: !!event.args.success });
  }

  // Normally the client tells us which operation was its own. When a hash was
  // recovered by hand there is no such claim — but we have already proved that an
  // operation from this wallet carrying this exact calldata is in the bundle, so a
  // single operation from that wallet can only be that one. Two and we decline to
  // guess rather than report the wrong outcome.
  const mine = userOpHash ? events.filter(e => e.hash === userOpHash.toLowerCase()) : events.filter(e => e.sender === batch.sender);
  if (mine.length !== 1) return "pending";
  if (mine[0].sender !== batch.sender) throw new Error("Transaction hash does not match the authorized transaction.");
  return mine[0].success ? "confirmed" : "reverted";
}
