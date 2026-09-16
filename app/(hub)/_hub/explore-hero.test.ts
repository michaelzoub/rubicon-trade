import { expect, it } from "vitest";
import type { Asset } from "@/lib/socialtrading/types";
import { PREVIEW_ASSETS } from "../../preview/fixture";
import { fit, plot } from "./explore-hero";

const asset = (id: string, change: number, extra: Partial<Asset> = {}): Asset =>
  ({ ...PREVIEW_ASSETS.VRT, id, symbol: id, change, ...extra });

it("ranks fit by the agent's own score before falling back to the label it chose", () => {
  expect(fit(asset("A", 0, { score: .31 }))).toBe(.31);
  expect(fit(asset("B", 0, { score: undefined, labelTone: "match" }))).toBeGreaterThan(fit(asset("C", 0, { score: undefined, labelTone: "explore" })));
});

it("places the biggest riser right of the biggest faller", () => {
  const [down, flat, up] = plot([asset("DOWN", -8), asset("FLAT", 0), asset("UP", 9)]);
  expect(down.x).toBeLessThan(flat.x);
  expect(flat.x).toBeLessThan(up.x);
});

it("places the closest match above the weakest one", () => {
  const [strong, weak] = plot([asset("S", 1, { score: .95 }), asset("W", -1, { score: .05 })]);
  expect(strong.y).toBeLessThan(weak.y);
});

it("spreads cards evenly when the data gives it nothing to separate them by", () => {
  const flat = plot([asset("A", 2, { score: .5 }), asset("B", 2, { score: .5 }), asset("C", 2, { score: .5 })]);
  const xs = flat.map(p => p.x);
  expect(new Set(xs).size).toBe(3);
});

it("leaves no two cards stacked on top of each other, and keeps them all on the stage", () => {
  const many = Array.from({ length: 10 }, (_, i) => asset(`A${i}`, (i % 3) - 1, { score: (i % 2) / 2 }));
  const placed = plot(many);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const clear = Math.abs(placed[i].x - placed[j].x) >= 15 || Math.abs(placed[i].y - placed[j].y) >= 16;
    expect(clear, `${placed[i].asset.id} overlaps ${placed[j].asset.id}`).toBe(true);
  }
  for (const p of placed) {
    expect(p.x).toBeGreaterThanOrEqual(1); expect(p.x).toBeLessThanOrEqual(80);
    expect(p.y).toBeGreaterThanOrEqual(1); expect(p.y).toBeLessThanOrEqual(80);
  }
});

it("handles an empty field", () => {
  expect(plot([])).toEqual([]);
});
