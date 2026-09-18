// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const { market } = vi.hoisted(() => ({ market: vi.fn() }));
vi.mock("./hub-provider", () => ({ useHub: () => ({ market }) }));
vi.mock("./price-trace", () => ({ PriceTrace: () => <svg aria-label="Price history" /> }));
import { MarketQuote } from "./market-quote";
it.each([true, false])("shows real price/change/chart or explicit unavailable states (available=%s)", async available => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  market.mockResolvedValue(available ? [{ price: 125, change: 2.5, chart: [{ time: 1, price: 120 }, { time: 2, price: 125 }] }] : []);
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MarketQuote chainId={8453} contract="0x4200000000000000000000000000000000000006" />));
    expect(market).toHaveBeenCalledWith(expect.objectContaining({ kind: "token", chainId: "8453", contract: "0x4200000000000000000000000000000000000006" }));
    if (available) {
      expect(container.textContent).toContain("$125.00");
      expect(container.textContent).toContain("+2.50% · 24h");
      expect(container.querySelector("svg")).not.toBeNull();
    } else {
      expect(container.textContent).toContain("Price unavailable");
      expect(container.textContent).toContain("24h change unavailable");
      expect(container.textContent).toContain("Price history unavailable");
    }
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
