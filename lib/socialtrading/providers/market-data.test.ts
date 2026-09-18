// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { providerJson } from "./market-data";

const URL_ = "https://api.example.invalid/quote";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { vi.useFakeTimers(); fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const busy = (status = 429, headers: Record<string, string> = {}) => new Response("busy", { status, headers });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

it("waits out a busy provider instead of burning the run's lookup", async () => {
  fetchMock.mockResolvedValueOnce(busy()).mockResolvedValueOnce(busy(503)).mockResolvedValueOnce(ok({ price: 312 }));
  const pending = providerJson<{ price: number }>(URL_, {});
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(pending).resolves.toEqual({ price: 312 });
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("gives up after a bounded number of attempts", async () => {
  fetchMock.mockResolvedValue(busy());
  const pending = providerJson(URL_, {});
  const assertion = expect(pending).rejects.toThrow(/busy/i);
  await vi.advanceTimersByTimeAsync(10_000);
  await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("does not retry a refusal that will not change", async () => {
  fetchMock.mockResolvedValue(new Response("nope", { status: 401 }));
  await expect(providerJson(URL_, {})).rejects.toThrow(/unavailable/i);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("honours the provider's own Retry-After", async () => {
  fetchMock.mockResolvedValueOnce(busy(429, { "retry-after": "2" })).mockResolvedValueOnce(ok({ price: 1 }));
  const pending = providerJson(URL_, {});
  await vi.advanceTimersByTimeAsync(1_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);   // still waiting out the 2s
  await vi.advanceTimersByTimeAsync(2_000);
  await expect(pending).resolves.toEqual({ price: 1 });
});

it("retries a timeout the same way", async () => {
  fetchMock.mockRejectedValueOnce(new Error("The operation was aborted")).mockResolvedValueOnce(ok({ price: 5 }));
  const pending = providerJson(URL_, {});
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(pending).resolves.toEqual({ price: 5 });
});
