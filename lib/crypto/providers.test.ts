import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransport } from "./http";
import { swapRequest } from "./chains";
import { PERMIT_TYPES, ROUTERS } from "./permit";
import { PERMIT2 } from "./aa";
import { createUniswap } from "./providers/uniswap";
import { createDexScreener } from "./providers/dexscreener";
import { createCoinGecko } from "./providers/coingecko";
import { createDefiLlama } from "./providers/defillama";
import { createCryptoServices } from "./services";
const wallet = "0x1111111111111111111111111111111111111111", input = "0x2222222222222222222222222222222222222222", output = "0x3333333333333333333333333333333333333333";
const req = { chainId: 1, wallet, tokenIn: input, tokenOut: output, amount: "1000000", slippageBps: 50 };
const raw = () => ({ routing: "CLASSIC", permitData: null, quote: { input: { token: input, amount: req.amount }, output: { token: output, amount: "2000000", recipient: wallet }, chainId: 1, swapper: wallet, tradeType: "EXACT_INPUT", slippage: .5 } });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("provider transport", () => {
  it("coalesces cached market reads and does not cache POST requests", async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ ok: true })); const http = createTransport(fetcher);
    await Promise.all([http("test", "https://example.com", { ttl: 1000 }), http("test", "https://example.com", { ttl: 1000 })]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await http("test", "https://example.com", { body: {}, ttl: 1000 }); await http("test", "https://example.com", { body: {}, ttl: 1000 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("reports rate limits without leaking response bodies and retries on a later call", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("secret provider body", { status: 429, headers: { "retry-after": "10" } })).mockResolvedValueOnce(Response.json({ ok: true }));
    const http = createTransport(fetcher);
    await expect(http("test", "https://example.com", { ttl: 1000 })).rejects.toMatchObject({ status: 429, retryAfter: "10", message: "test rate limit reached; retry later (429)." });
    await expect(http("test", "https://example.com", { ttl: 1000 })).resolves.toEqual({ ok: true });
  });
});
describe("market adapters", () => {
  it("keeps missing DEX prices and liquidity null and preserves chain identity", async () => {
    const http = createTransport(vi.fn().mockResolvedValue(Response.json({ pairs: [{ chainId: "base", dexId: "uniswap", pairAddress: input, baseToken: { address: input, symbol: "A", name: "A" }, quoteToken: { address: output, symbol: "B", name: "B" } }] })));
    expect((await createDexScreener(http).search("A"))[0]).toMatchObject({ chain: "base", priceUsd: null, liquidityUsd: null, volume24h: null });
  });
  it("allows public CoinGecko data without a key and supports Pro authentication", async () => {
    vi.stubEnv("COINGECKO_API_KEY", ""); vi.stubEnv("COINGECKO_API_PLAN", "demo");
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ prices: [] })); const gecko = createCoinGecko(createTransport(fetcher));
    await gecko.history("ethereum", 30); expect(fetcher.mock.calls[0][0]).toContain("https://api.coingecko.com/");
    vi.stubEnv("COINGECKO_API_PLAN", "pro"); vi.stubEnv("COINGECKO_API_KEY", "test-key");
    await gecko.history("ethereum", 7); expect(fetcher.mock.calls[1][1].headers["x-cg-pro-api-key"]).toBe("test-key");
    expect(() => gecko.history("ethereum", 366)).toThrow();
  });
  it("rejects stale or low-confidence valuations, uses decimals and rounds up", async () => {
    let price = { price: 1.001, decimals: 6, confidence: 1, timestamp: Date.now() / 1000 };
    const fetcher = vi.fn().mockImplementation(async () => Response.json({ coins: { [`ethereum:${input}`]: price } }));
    const value = () => createDefiLlama(createTransport(fetcher)).value({ chainId: 1, address: input }, "1000000");
    expect(await value()).toBe(1.01);
    price = { ...price, timestamp: Date.now() / 1000 - 600 }; await expect(value()).rejects.toThrow(/fresh/);
    price = { ...price, timestamp: Date.now() / 1000, confidence: .2 }; await expect(value()).rejects.toThrow(/reliable/);
  });
  it("reports partial research failures alongside successful sources", async () => {
    const services = createCryptoServices({ discovery: { search: vi.fn(), pairs: vi.fn().mockResolvedValue([]) }, metadata: { ...createCoinGecko(), contract: vi.fn().mockRejectedValue(new Error("rate limited")) }, defi: { ...createDefiLlama(), price: vi.fn().mockRejectedValue(new Error("missing")) } });
    const result = await services.research({ chainId: 1, address: input });
    expect(result.sources[0]).toMatchObject({ provider: "DexScreener", data: [] }); expect(result.sources[1]).toMatchObject({ error: "rate limited" });
  });
});
describe("Uniswap execution adapter", () => {
  it.each([{ amount: "1.5" }, { amount: "1e18" }, { amount: "0" }, { slippageBps: 101 }, { chainId: 999 }, { tokenOut: input }])("rejects unsafe request %j", patch => {
    expect(() => swapRequest({ ...req, ...patch })).toThrow();
  });
  it("uses exact-input classic routing, leaves Permit2 enabled, and does not cache quotes", async () => {
    vi.stubEnv("UNISWAP_API_KEY", "test-key"); const fetcher = vi.fn().mockImplementation(async () => Response.json(raw()));
    const api = createUniswap(createTransport(fetcher)); const quote = await api.quote(req); await api.quote(req);
    expect(quote.minimumOutput).toBe("1990000"); expect(fetcher).toHaveBeenCalledTimes(2);
    // Disabling Permit2 made the gateway answer NoRouteFoundError for every pair
    // and size we tried, so the header must never come back.
    const init = fetcher.mock.calls[0][1]; expect(init.headers["x-permit2-disabled"]).toBeUndefined();
    expect(JSON.parse(init.body)).toMatchObject({ type: "EXACT_INPUT", protocols: ["V2", "V3"], recipient: wallet, slippageTolerance: .5 });
  });
  it("accepts the Permit2 data the gateway now returns on every classic quote", async () => {
    vi.stubEnv("UNISWAP_API_KEY", "test-key");
    const withPermit = { ...raw(), permitData: { domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2 }, types: PERMIT_TYPES, values: { details: { token: input, amount: req.amount, expiration: String(Math.floor(Date.now()/1000)+1800), nonce: "0" }, spender: ROUTERS[1], sigDeadline: String(Math.floor(Date.now()/1000)+1800) } } };
    await expect(createUniswap(createTransport(vi.fn().mockResolvedValue(Response.json(withPermit)))).quote(req)).resolves.toMatchObject({ minimumOutput: "1990000" });
  });
  it.each(["routing", "recipient", "amount", "slippage"])("rejects mismatched %s", async field => {
    vi.stubEnv("UNISWAP_API_KEY", "test-key"); const response = raw();
    if (field === "routing") response.routing = "DUTCH_V3";
    if (field === "recipient") response.quote.output.recipient = input;
    if (field === "amount") response.quote.input.amount = "100";
    if (field === "slippage") response.quote.slippage = 5;
    await expect(createUniswap(createTransport(vi.fn().mockResolvedValue(Response.json(response)))).quote(req)).rejects.toThrow(/unsupported|mismatched/);
  });
  it("rejects expired quotes and unexpected native spend", async () => {
    vi.stubEnv("UNISWAP_API_KEY", "test-key");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(raw())).mockResolvedValueOnce(Response.json({ swap: { chainId: 1, from: wallet, to: ROUTERS[1], data: "0xaabb", value: "1" } }));
    const api = createUniswap(createTransport(fetcher)); const q = await api.quote(req);
    await expect(api.swap({ ...q, expiresAt: 0 })).rejects.toThrow(/expired/);
    await expect(api.swap(q)).rejects.toThrow(/native/);
  });
  it("simulates the swap after approvals have settled", async () => {
    vi.stubEnv("UNISWAP_API_KEY", "test-key");
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(raw())).mockResolvedValueOnce(Response.json({ swap: { chainId: 1, from: wallet, to: ROUTERS[1], data: "0xaabb", value: "0" } }));
    const api = createUniswap(createTransport(fetcher));
    await api.swap(await api.quote(req));
    expect(JSON.parse(fetcher.mock.calls[1][1].body).simulateTransaction).toBe(true);
  });
});
describe("unit conversion", () => {
  it("parses decimal strings exactly and formats base units back", async () => {
    const { parseUnits, formatUnits } = await import("./chains");
    expect(parseUnits("1.5", 6)).toBe("1500000"); expect(parseUnits("0.000001", 6)).toBe("1"); expect(parseUnits("1,000", 2)).toBe("100000");
    expect(parseUnits("123456789.123456789123456789", 18)).toBe("123456789123456789123456789");
    expect(() => parseUnits("0.0000001", 6)).toThrow(/decimal places/); expect(() => parseUnits("-1", 6)).toThrow(); expect(() => parseUnits("0", 6)).toThrow(/zero/);
    expect(formatUnits("1500000", 6)).toBe("1.5"); expect(formatUnits("1", 18)).toBe("0"); expect(formatUnits("123456789123456789123456789", 18)).toBe("123,456,789.123456"); expect(formatUnits("42", null)).toBe("42");
  });
});
describe("buyable token search", () => {
  it("keeps the deepest pair per token on supported chains, flags tokenized stocks and thin pools, and ranks exact symbols first", async () => {
    const { normalizeMatches } = await import("./search");
    const pair = (over: Record<string, unknown>) => ({ source: "dexscreener", chain: "base", address: "0xpair", dex: "uniswap", url: "", base: { address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether" }, quote: { address: "0x1", symbol: "USDC", name: "USDC" }, priceUsd: 4000, liquidityUsd: 1_000_000, volume24h: 1, change24h: 1, marketCap: null, fetchedAt: "", ...over }) as import("./types").Pair;
    const out = normalizeMatches([
      pair({ liquidityUsd: 10 }), pair({ liquidityUsd: 5_000_000, dex: "aerodrome" }),
      pair({ chain: "solana", base: { address: "So1ana", symbol: "SOL", name: "Solana" } }),
      pair({ base: { address: "0x8a8e5ca3b5d8d3b08a1b6b2fd2b9e7c3d0a1f2e3", symbol: "bNVDA", name: "Backed NVIDIA" }, liquidityUsd: 20_000 }),
    ], "bnvda");
    expect(out.map(t => t.symbol)).toEqual(["bNVDA", "WETH"]);
    expect(out[1]).toMatchObject({ dex: "aerodrome", liquidityUsd: 5_000_000, chainId: 8453, kind: "crypto", thin: false });
    expect(out[0]).toMatchObject({ kind: "stock", thin: true });
  });
});
