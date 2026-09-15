import "server-only";
export class ProviderError extends Error {
  constructor(public provider: string, public status: number, public retryAfter?: string | null) { super(`${provider} ${status === 429 ? "rate limit reached; retry later" : status === 503 ? "is not configured" : "request failed"} (${status}).`); }
}
/** Bounded public-data cache with request coalescing. Never caches quotes, wallet data, or errors. */
export function createTransport(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { until: number; value: unknown }>();
  const pending = new Map<string, Promise<unknown>>();
  return async function request<T>(provider: string, url: string, options: { headers?: Record<string, string>; body?: unknown; ttl?: number } = {}): Promise<T> {
    const key = `${provider}:${url}`; const ttl = options.body === undefined ? options.ttl ?? 0 : 0;
    const hit = cache.get(key); if (ttl && hit && hit.until > Date.now()) return hit.value as T;
    if (ttl && pending.has(key)) return pending.get(key) as Promise<T>;
    const run = async () => {
      let response: Response;
      try { response = await fetcher(url, { method: options.body === undefined ? "GET" : "POST", headers: { accept: "application/json", ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...options.headers }, body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: AbortSignal.timeout(15_000), cache: "no-store" }); }
      catch { throw new ProviderError(provider, 504); }
      if (!response.ok) throw new ProviderError(provider, response.status, response.headers.get("retry-after"));
      let value: T; try { value = await response.json(); } catch { throw new ProviderError(provider, 502); }
      if (ttl) { if (cache.size >= 250) cache.delete(cache.keys().next().value!); cache.set(key, { until: Date.now() + ttl, value }); }
      return value;
    };
    const task = run(); if (ttl) pending.set(key, task);
    try { return await task; } finally { if (ttl) pending.delete(key); }
  };
}
export type Transport = ReturnType<typeof createTransport>;
export const http = createTransport();
