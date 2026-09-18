import { expect, it, vi } from "vitest";
const { pairs, contract, history } = vi.hoisted(() => ({ pairs: vi.fn(), contract: vi.fn(), history: vi.fn() }));
vi.mock("@/lib/crypto/services", () => ({ cryptoServices: { discovery: { pairs }, metadata: { contract, history } } }));
import { tokenMarket } from "./token-market";
const token = "0x4200000000000000000000000000000000000006";
it("uses exact-contract prices and loads that token's history", async () => {
  pairs.mockResolvedValue([{ chain: "base", address: "pair", base: { address: token, symbol: "WETH", name: "Ether" }, quote: { symbol: "USDC" }, priceUsd: 2000, change24h: 3, liquidityUsd: 100000, volume24h: 200, dex: "uniswap", url: "", fetchedAt: "2026-09-18T00:00:00Z" }]);
  contract.mockResolvedValue({ id: "weth", symbol: "weth", name: "Wrapped Ether" });
  history.mockResolvedValue({ prices: [[1, 1900], [2, 2000]] });
  expect(await tokenMarket(8453, token, 7)).toMatchObject({ price: 2000, change: 3, chart: [{ time: 1, price: 1900 }, { time: 2, price: 2000 }] });
  expect(history).toHaveBeenCalledWith("weth", 7);
});
it("keeps quote data when token history fails", async () => {
  pairs.mockResolvedValue([{ chain: "base", address: "pair", base: { address: token, symbol: "WETH" }, quote: { symbol: "USDC" }, priceUsd: 2000, change24h: 3, liquidityUsd: 100000, dex: "uniswap" }]);
  contract.mockResolvedValue({ id: "weth" });
  history.mockRejectedValue(new Error("No history"));
  expect(await tokenMarket(8453, token, 7)).toMatchObject({ price: 2000, chart: [] });
});
