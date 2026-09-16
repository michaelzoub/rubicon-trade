import { expect, it } from "vitest";
import { presenceStatus } from "./agent-presence";

it("leads with what the person chose to watch", () => {
  expect(presenceStatus([{ symbol: "NVDA", name: "Nvidia" }, { symbol: "VRT", name: "Vertiv" }], ["Energy"]))
    .toBe("Watching NVDA, VRT");
});

it("counts the rest rather than listing every name", () => {
  const many = ["NVDA", "VRT", "CRWV", "OKLO", "CEG"].map(symbol => ({ symbol, name: symbol }));
  expect(presenceStatus(many, [])).toBe("Watching NVDA, VRT, CRWV and 2 more");
});

it("falls back to the name when an interest has no symbol", () => {
  expect(presenceStatus([{ name: "Nuclear power" }], [])).toBe("Watching Nuclear power");
});

it("says what it picked up on its own when nothing is watched yet", () => {
  expect(presenceStatus([], ["Energy", "AI", "Crypto"])).toBe("Learning from how you explore · Energy, AI");
});

it("admits it knows nothing yet rather than inventing a status", () => {
  expect(presenceStatus([], [])).toBe("Getting to know you");
});
