import { afterEach, expect, it, vi } from "vitest";
import { marketData } from "./market-data";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function mockMarket() {
  vi.stubEnv("MASSIVE_API_KEY", "test-secret");
  const fetcher = vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/v3/reference/tickers") return Response.json({ results: [{ ticker: "NVDA", name: "NVIDIA" }] });
    if (url.pathname === "/vX/reference/ipos") return Response.json({ results: [{ ticker: "NVDA", issuer_name: "NVIDIA", listing_date: "2026-09-15" }, { ticker: "NVDA", issuer_name: "NVIDIA", listing_date: "2026-09-15" }] });
    if (url.pathname === "/v3/reference/tickers/NVDA") return Response.json({ results: { ticker: "NVDA", name: "NVIDIA", market_cap: 1000000000, description: "Makes chips.", branding: { icon_url: "https://api.massive.com/v1/reference/company-branding/test/icon.png" } } });
    if (url.pathname.includes("/snapshot/")) return Response.json({ ticker: { lastTrade: { p: 125.5 }, todaysChangePerc: 2 } });
    if (url.pathname.includes("/aggs/")) return Response.json({ results: [{ t: 1700000000000, c: 120 }] });
    return Response.json({ results: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("enriches stock search with a price even without a snapshot timestamp, metadata and a safe logo URL", async () => {
  mockMarket();
  const [asset] = await marketData.search("NVIDIA");
  expect(asset).toMatchObject({ price: 125.5, marketCap: 1000000000, description: "Makes chips.", logo: "/api/trade/logo/NVDA" });
  expect(JSON.stringify(asset)).not.toContain("test-secret");
});
it("uses the supported IPO listing date and removes duplicate tickers", async () => {
  const fetcher = mockMarket();
  const assets = await marketData.ipos();
  expect(assets).toHaveLength(1);
  expect(assets[0].description).toContain("Listing 2026-09-15");
  expect(fetcher.mock.calls.some(([url]) => url.includes("sort=listing_date"))).toBe(true);
});
it("retains company results when quote enrichment fails", async () => {
  mockMarket();
  vi.stubGlobal("fetch", async (url: string) => url.includes("tickers?market") ? Response.json({ results: [{ ticker: "NVDA", name: "NVIDIA" }] }) : new Response(null, { status: 503 }));
  expect(await marketData.search("NVIDIA")).toEqual([expect.objectContaining({ symbol: "NVDA", price: null })]);
});
