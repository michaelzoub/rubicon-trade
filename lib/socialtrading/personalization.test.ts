import { expect, it } from "vitest";
import { badgePalette, suggestedThemes } from "./themes";
import { assetSuggestions } from "./suggestions";
import { newProfile, readProfile } from "./profile";

it("blends theme palettes independently of selection order", () => {
  expect(badgePalette(["energy", "ai"])).toEqual(badgePalette(["ai", "energy"]));
  expect(badgePalette(["energy", "ai"])).not.toEqual(badgePalette(["energy"]));
});

it("uses thesis and core interests to shape suggestions without selecting them", () => {
  expect(suggestedThemes("AI inference will need nuclear power.")).toEqual(["energy", "ai"]);
  expect(assetSuggestions(["energy"], "")[0].id).toBe("ceg");
  expect(assetSuggestions(["healthcare"], "")[0].id).toBe("lly");
  expect(assetSuggestions(["crypto"], "")[0].id).toBe("btc");
  expect(assetSuggestions(["energy"], "", "Nvidia")[0].id).toBe("nvda");
  expect(newProfile("alice").themes).toEqual([]);
});

it("migrates the old four-step profile without losing assets or permissions", () => {
  const legacy = { ...newProfile("alice"), version: 1, thesis: "AI infrastructure", permissionConfigured: true, step: 4, completedAt: "2026-09-14T00:00:00Z" };
  const restored = readProfile(JSON.stringify(legacy), "alice");
  expect(restored.version).toBe(2);
  expect(restored.step).toBe(5);
  expect(restored.thesis).toBe(legacy.thesis);
  expect(restored.completedAt).toBe(legacy.completedAt);
});

it("restores selected themes and filters unknown values", () => {
  const profile = { ...newProfile("alice"), thesis: "Energy", themes: ["energy", "ai", "unknown", "energy"], step: 3 };
  expect(readProfile(JSON.stringify(profile), "alice").themes).toEqual(["energy", "ai"]);
});

import { inferredThemes, learn, LEARNING_FULL_TEXT, relevance } from "./personalization";
import { PLANS } from "./plans";
import type { Asset, HubState } from "./types";

function hub(overrides: Partial<HubState> = {}): HubState {
  return { revision: 0, profile: { ...newProfile("alice"), thesis: "Power availability will be the bottleneck for AI inference.", themes: ["ai", "energy"], interests: [{ id: "VRT", symbol: "VRT", name: "Vertiv", kind: "stock" }], permissionConfigured: true, step: 5, completedAt: "2026-09-14T00:00:00Z" },
    dislikes: [], preferences: [], inferred: [], signals: [], chats: [], events: [], trades: [], ...overrides };
}
const asset = (over: Partial<Asset>): Asset => ({ id: "X", symbol: "X", name: "X", kind: "stock", price: 1, change: 0, asOf: null, source: "Massive", themes: [], chart: [], news: [], ...over });

it("labels assets from the user's explicit profile first", () => {
  const state = hub();
  expect(relevance(asset({ id: "VRT", symbol: "VRT", name: "Vertiv", description: "Power and cooling infrastructure for data centers" }), state).label).toBe("Strong match for your Energy thesis");
  expect(relevance(asset({ symbol: "CEG", name: "Constellation Energy", description: "Nuclear power utility" }), state).label).toMatch(/Energy/);
  expect(relevance(asset({ symbol: "COST", name: "Costco", description: "Retail warehouse club" }), state).label).toBe("Outside your usual interests");
  expect(relevance(asset({ kind: "crypto", symbol: "DOGE", name: "Dogecoin", themes: ["Meme"] }), hub({ dislikes: ["memecoins"] })).tone).toBe("muted");
});

it("learns from repeated engagement and propagates to themes without touching explicit preferences", () => {
  const state = hub();
  for (let i = 0; i < 4; i++) learn(state, "opened", `OKLO${i}`, ["energy"]);
  learn(state, "watched", "OKLO", ["energy"]);
  const energy = state.inferred.find(i => i.id === "energy")!;
  expect(energy.weight).toBeGreaterThan(0.3);
  expect(energy.confidence).toBeGreaterThanOrEqual(0.4);
  expect(state.profile.themes).toEqual(["ai", "energy"]);
  expect(state.events.some(e => e.kind === "learning")).toBe(true);
  expect(inferredThemes(hub({ inferred: [{ id: "healthcare", weight: .5, confidence: .5, count: 5, updatedAt: "" }] }))).toEqual(["healthcare"]);
  expect(relevance(asset({ symbol: "LLY", name: "Eli Lilly", description: "Pharma" }), hub({ inferred: [{ id: "healthcare", weight: -.4, confidence: .5, count: 5, updatedAt: "" }] })).label).toBe("You usually ignore assets like this");
});

it("ignores duplicate signals inside a minute", () => {
  const state = hub();
  learn(state, "opened", "VRT", ["energy"]);
  expect(learn(state, "opened", "VRT", ["energy"])).toBeNull();
  expect(state.signals).toHaveLength(1);
});

it("stops learning new assets at the plan cap, keeps learning themes, and explains once", () => {
  const limits = { ...PLANS.free.limits, learnedAssets: 2 };
  const state = hub();
  learn(state, "opened", "OKLO", ["energy"], limits);
  learn(state, "opened", "SMR", ["energy"], limits);
  expect(learn(state, "opened", "CEG", ["energy"], limits)).toBeNull();
  expect(state.inferred.filter(i => i.id === "CEG")).toEqual([]);
  expect(state.inferred.find(i => i.id === "energy")?.count).toBe(3);
  // Known assets keep updating; only new ones are refused.
  expect(learn(state, "watched", "OKLO", [], limits)?.count).toBe(2);
  learn(state, "opened", "VST", [], limits);
  expect(state.events.filter(e => e.text === LEARNING_FULL_TEXT)).toHaveLength(1);
  expect(state.events.find(e => e.text === LEARNING_FULL_TEXT)?.detail).toMatch(/remember 2 assets.*Forget one/);
  state.inferred = state.inferred.filter(i => i.id !== "SMR");
  expect(learn(state, "opened", "CEG", [], limits)?.id).toBe("CEG");
});
