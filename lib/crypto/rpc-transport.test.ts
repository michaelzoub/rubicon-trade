import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock("./http", () => ({ http: mock.http }));
import { clearRpcCache, rpc } from "./rpc";

const limited = (retryAfter?: string) => Object.assign(new Error("Chain RPC rate limit reached; retry later (429)."), { status: 429, retryAfter });
const decimals = [{ to: `0x${"11".repeat(20)}`, data: "0x313ce567" }, "latest"];

beforeEach(() => { vi.stubEnv("CRYPTO_RPC_URL_8453", "https://one.example https://two.example"); mock.http.mockReset(); clearRpcCache(); });

it("rides out a rate limit by asking the next endpoint instead of failing the purchase", async () => {
  mock.http.mockRejectedValueOnce(limited("0")).mockResolvedValueOnce({ result: "0x2105" });
  await expect(rpc<string>(8453, "eth_chainId", [])).resolves.toBe("0x2105");
  expect(mock.http.mock.calls.map(call => call[1])).toEqual(["https://one.example", "https://two.example"]);
});

it("gives up with the rate limit intact once every endpoint has refused", async () => {
  mock.http.mockRejectedValue(limited("0"));
  await expect(rpc(8453, "eth_getTransactionCount", ["0x1", "pending"])).rejects.toMatchObject({ status: 429 });
  expect(mock.http).toHaveBeenCalledTimes(4);
});

it("treats a refusal delivered inside a 200 as a rate limit, not as an answer", async () => {
  mock.http.mockResolvedValueOnce({ error: { message: "daily request count exceeded" } }).mockResolvedValueOnce({ result: "0x6" });
  await expect(rpc<string>(8453, "eth_gasPrice", [])).resolves.toBe("0x6");
});

it("surfaces a genuine JSON-RPC error rather than retrying it", async () => {
  mock.http.mockResolvedValue({ error: { message: "execution reverted" } });
  await expect(rpc(8453, "eth_call", decimals)).rejects.toThrow("could not verify");
  expect(mock.http).toHaveBeenCalledTimes(1);
});

it("asks once for an answer that cannot change, and once for concurrent readers of the same question", async () => {
  mock.http.mockResolvedValue({ result: `0x${"0".repeat(62)}12` });
  const [a, b] = await Promise.all([rpc(8453, "eth_call", decimals), rpc(8453, "eth_call", decimals)]);
  expect(a).toBe(b);
  await rpc(8453, "eth_call", decimals);
  expect(mock.http).toHaveBeenCalledTimes(1);
});

it("never remembers a nonce, because a stale one would reserve the wrong slot", async () => {
  mock.http.mockResolvedValueOnce({ result: "0x7" }).mockResolvedValueOnce({ result: "0x8" });
  await expect(rpc(8453, "eth_getTransactionCount", ["0x1", "pending"])).resolves.toBe("0x7");
  await expect(rpc(8453, "eth_getTransactionCount", ["0x1", "pending"])).resolves.toBe("0x8");
});
