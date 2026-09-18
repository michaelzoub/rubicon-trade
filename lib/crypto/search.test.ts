import { expect, it } from "vitest";
import { withCatalogMatches } from "./search";

it("deduplicates catalog contracts and preserves discovered market data and liquidity warnings", () => {
  const pinned = withCatalogMatches("nvda")[0];
  const discovered = { ...pinned, address: pinned.address.toUpperCase(), symbol: "NVDA", name: "External name", kind: "crypto" as const, priceUsd: 180, thin: true };
  expect(withCatalogMatches("nvidia", [discovered])).toEqual([
    expect.objectContaining({ symbol: "NVDAc", name: "NVIDIA", kind: "stock", priceUsd: 180, thin: true }),
  ]);
});

it("does not add unrelated recommendations to search results", () => {
  expect(withCatalogMatches("no-such-instrument")).toEqual([]);
  expect(withCatalogMatches("   ")).toEqual([]);
});
