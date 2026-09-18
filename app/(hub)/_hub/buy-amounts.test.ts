import { expect, it } from "vitest";
import { buyAmounts, DEFAULT_AMOUNTS } from "./buy-amounts";

it("offers the familiar row until it knows what the buyer holds", () => {
  expect(buyAmounts(null)).toEqual(DEFAULT_AMOUNTS);
});

it("offers the round numbers that fit, and all of it last", () => {
  expect(buyAmounts(412.87)).toEqual(["50", "100", "250", "412.87"]);
  expect(buyAmounts(62.4)).toEqual(["10", "25", "50", "62.40"]);
});

it("never offers an amount the balance cannot cover", () => {
  for (const spendable of [7.3, 41.02, 99.99, 1000.5]) {
    for (const amount of buyAmounts(spendable)) expect(Number(amount)).toBeLessThanOrEqual(spendable);
  }
});

it("splits a small balance into parts rather than one all-or-nothing chip", () => {
  expect(buyAmounts(7.3)).toEqual(["1.82", "3.65", "7.30"]);
  expect(buyAmounts(3)).toEqual(["1.50", "3"]);
});

it("says nothing when there is nothing to suggest", () => {
  expect(buyAmounts(0.4)).toEqual([]);
  expect(buyAmounts(-2)).toEqual([]);
});

it("does not repeat the balance when it is already a round number", () => {
  expect(buyAmounts(50)).toEqual(["10", "25", "50"]);
});
