// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const A = "https://a.invalid", B = "https://b.invalid", C = "https://c.invalid";
let fetchMock: ReturnType<typeof vi.fn>;
const ok = (result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200, headers: { "Content-Type": "application/json" } });
const hostOf = (input: unknown) => new URL(String(input)).origin;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("CRYPTO_RPC_URL_8453", `${A} ${B} ${C}`);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const call = async () => {
  const { rpc, clearRpcCache } = await import("./rpc");
  clearRpcCache();
  return rpc<string>(8453, "eth_getCode", ["0x1", "latest"]);
};

it("moves to the next provider when one refuses with 403", async () => {
  // A single shared endpoint throttling with 403 used to kill the whole
  // purchase, even with two working providers configured behind it.
  fetchMock.mockImplementation(async (input: unknown) =>
    hostOf(input) === A ? new Response("forbidden", { status: 403 }) : ok("0x6000"));
  await expect(call()).resolves.toBe("0x6000");
  expect(hostOf(fetchMock.mock.calls[0][0])).toBe(A);
  expect(hostOf(fetchMock.mock.calls[1][0])).toBe(B);
});

it("still fails when every provider refuses", async () => {
  fetchMock.mockResolvedValue(new Response("forbidden", { status: 403 }));
  await expect(call()).rejects.toThrow(/403/);
});

it("does not fail over on an error that is genuinely ours", async () => {
  // A malformed request is not something another provider will answer.
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "invalid argument" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  await expect(call()).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps rotating on rate limits too", async () => {
  fetchMock.mockImplementation(async (input: unknown) =>
    hostOf(input) === A ? new Response("busy", { status: 429 }) : ok("0x6000"));
  await expect(call()).resolves.toBe("0x6000");
});
