import "server-only";
import { chain } from "./chains";
import { http } from "./http";
import type { SwapBatch, Transaction } from "./types";

/** Every read this app makes of a chain goes through here, which is why the
 * pacing lives here too.
 *
 * A single purchase asks the chain a lot of small questions: where the money
 * is, what the token's decimals are, what gas costs, whether the receipt has
 * landed — and the resolver asks them for several wallets at once while the
 * buy panel re-asks them on every keystroke. Against a shared or free endpoint
 * that burst is what a 429 actually is: not a broken purchase, just too many
 * questions at once. So the transport answers the repeats from memory, asks
 * each distinct question only once while it is in flight, paces what is left,
 * and retries a refusal on the next endpoint instead of surfacing it. */

/** Endpoints for a chain, in preference order. One URL is the common case; a
 * comma- or whitespace-separated list gives the retry somewhere else to go. */
function endpoints(chainId: number): string[] {
  const urls = (process.env[`CRYPTO_RPC_URL_${chainId}`] ?? "").split(/[\s,]+/).filter(url => url.startsWith("https://"));
  if (!urls.length) throw new Error(`Configure CRYPTO_RPC_URL_${chainId} for transaction verification.`);
  return urls;
}

/** `decimals()`, `symbol()`, `name()` — answers that cannot change, so asking
 * twice is waste rather than freshness. */
const IMMUTABLE_CALL = new Set(["0x313ce567", "0x95d89b41", "0x06fdde03"]);

/** How long an answer stays good for. Anything that decides whether funds move
 * — nonces, receipts, block numbers, gas estimates — is never remembered, so
 * verification and nonce reservation still see the chain as it is right now. */
function ttl(method: string, params: unknown[]): number {
  switch (method) {
    case "eth_chainId": return 300_000;
    case "eth_call": return IMMUTABLE_CALL.has(String((params[0] as { data?: string } | undefined)?.data ?? "").slice(0, 10).toLowerCase()) ? 600_000 : 2_000;
    case "eth_getBalance": return 2_000;
    case "eth_gasPrice": case "eth_maxPriorityFeePerGas": case "eth_feeHistory": return 5_000;
    default: return 0;
  }
}

const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
/** Test seam: a fresh chain for a fresh scenario. */
export function clearRpcCache() { cache.clear(); pending.clear(); }

/** Statuses that mean "not now" rather than "no". */
const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);
/** One provider refusing us says nothing about the next one: a shared endpoint
 * throttles with 403 as readily as 429, and a key can be rejected by one host
 * while another is wide open. Fatal only when it is the last endpoint left —
 * otherwise a single refusal killed a purchase that two working providers could
 * have served. */
const REFUSED = new Set([401, 403, 404, 410, 451]);
const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const statusOf = (error: unknown) => typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 0;
/** Honour the server's own advice, but never stall a purchase for longer than
 * the person would wait. */
const retryAfter = (error: unknown) => {
  const seconds = Number((error as { retryAfter?: string | null })?.retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 4_000) : 0;
};
const backoff = (attempt: number) => 150 * 2 ** attempt + Math.random() * 120;

/** No more than a handful of questions in the air per chain. Bursting is what
 * trips a rate limit in the first place; waiting a few milliseconds is cheaper
 * than being refused and retried. */
const CONCURRENCY = 5;
const lanes = new Map<number, { active: number; waiting: (() => void)[] }>();
async function paced<T>(chainId: number, run: () => Promise<T>): Promise<T> {
  const lane = lanes.get(chainId) ?? { active: 0, waiting: [] };
  lanes.set(chainId, lane);
  if (lane.active >= CONCURRENCY) await new Promise<void>(resolve => lane.waiting.push(resolve));
  lane.active++;
  try { return await run(); }
  finally { lane.active--; lane.waiting.shift()?.(); }
}

async function send<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  const urls = endpoints(chainId);
  let failure: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const response = await http<{ result: T; error?: { message?: string } }>("Chain RPC", urls[attempt % urls.length], { body: { jsonrpc: "2.0", id: 1, method, params } });
      // Some endpoints refuse inside a 200 rather than with a status. That is
      // still "not now", and it is still worth asking the next one.
      if (response.error) {
        const message = String(response.error.message ?? "");
        if (!/limit|throttl|capacity|too many|busy|exceeded/i.test(message)) throw new Error("Chain RPC could not verify the transaction.");
        failure = Object.assign(new Error(`Chain RPC rate limit reached; retry later (429).`), { status: 429 });
      } else {
        if (!("result" in response)) throw new Error("Chain RPC could not verify the transaction.");
        return response.result;
      }
    } catch (error) {
      const status = statusOf(error);
      const elsewhere = REFUSED.has(status) && urls.length > 1;
      if (!TRANSIENT.has(status) && !elsewhere) throw error;
      failure = error;
      // A refusal is not congestion: the next endpoint is a different company,
      // so ask it now rather than sleeping first.
      if (elsewhere && attempt < ATTEMPTS - 1) continue;
    }
    if (attempt === ATTEMPTS - 1) break;
    await sleep(Math.max(retryAfter(failure), backoff(attempt)));
  }
  throw failure;
}

export async function rpc<T>(chainId: number, method: string, params: unknown[]): Promise<T> {
  chain(chainId);
  const lifetime = ttl(method, params);
  if (!lifetime) return paced(chainId, () => send<T>(chainId, method, params));
  const key = `${chainId}:${method}:${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const inflight = pending.get(key);
  if (inflight) return inflight as Promise<T>;
  const task = paced(chainId, () => send<T>(chainId, method, params)).then(value => {
    if (cache.size >= 400) cache.delete(cache.keys().next().value!);
    cache.set(key, { until: Date.now() + lifetime, value });
    return value;
  });
  pending.set(key, task);
  try { return await task; }
  finally { pending.delete(key); }
}

export async function verifyTransaction(tx: Transaction, hash: string): Promise<"pending" | "confirmed" | "reverted"> {
  const [network, sent, receipt] = await Promise.all([
    rpc<string>(tx.chainId, "eth_chainId", []),
    rpc<{ from: string; to: string; input: string; value: string; nonce?: string } | null>(tx.chainId, "eth_getTransactionByHash", [hash]),
    rpc<{ status: string; blockNumber: string; blockHash: string } | null>(tx.chainId, "eth_getTransactionReceipt", [hash]),
  ]);
  if (BigInt(network) !== BigInt(tx.chainId)) throw new Error("RPC network mismatch.");
  if (!sent) return "pending";
  if (sent.from.toLowerCase() !== tx.from.toLowerCase() || sent.to?.toLowerCase() !== tx.to.toLowerCase() || sent.input.toLowerCase() !== tx.data.toLowerCase() || BigInt(sent.value) !== BigInt(tx.value) || (tx.nonce !== undefined && (sent.nonce === undefined || BigInt(sent.nonce) !== BigInt(tx.nonce)))) throw new Error("Transaction hash does not match the authorized transaction.");
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
  // EntryPoint emits one UserOperationEvent per operation in execution order.
  // A hash for another operation from the same wallet is not evidence that OUR
  // authorized calldata succeeded.
  if (events.length !== ops.length) return "pending";
  const matched = ops[events.indexOf(mine[0])];
  if (mine[0].sender !== batch.sender || matched.sender.toLowerCase() !== batch.sender || matched.callData.toLowerCase() !== batch.callData.toLowerCase()) throw new Error("Transaction hash does not match the authorized transaction.");
  return mine[0].success ? "confirmed" : "reverted";
}
