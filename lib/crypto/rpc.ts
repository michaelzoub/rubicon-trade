import "server-only";
import { chain } from "./chains";
import { http } from "./http";
import type { Transaction } from "./types";
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
  const block = await rpc<{ hash: string } | null>(tx.chainId, "eth_getBlockByNumber", [receipt.blockNumber, false]);
  const head = await rpc<string>(tx.chainId, "eth_blockNumber", []);
  if (!block || block.hash !== receipt.blockHash || BigInt(head) - BigInt(receipt.blockNumber) < BigInt(2)) return "pending";
  if (receipt.status !== "0x0" && receipt.status !== "0x1") throw new Error("Invalid transaction receipt.");
  return receipt.status === "0x1" ? "confirmed" : "reverted";
}
