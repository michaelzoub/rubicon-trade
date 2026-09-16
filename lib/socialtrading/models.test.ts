import { describe, expect, it } from "vitest";
import { MODELS, TIER_ORDER, defaultModelForPlan, formatContext, modelById, modelsForPlan, modelsInTier, tiersForPlan, topTierForPlan } from "./models";
import { PLANS, PLAN_ORDER, type PlanId } from "./plans";

describe("catalogue", () => {
  it("has no duplicate ids", () => {
    expect(new Set(MODELS.map(m => m.id)).size).toBe(MODELS.length);
  });

  it("prices every model above zero on both sides", () => {
    for (const m of MODELS) {
      expect(m.usdPerMillion.in, m.id).toBeGreaterThan(0);
      expect(m.usdPerMillion.out, m.id).toBeGreaterThan(0);
      expect(m.context, m.id).toBeGreaterThan(0);
    }
  });

  it("uses OpenRouter slugs, which always carry a provider prefix", () => {
    for (const m of MODELS) expect(m.id, m.id).toMatch(/^[a-z0-9-]+\/[a-zA-Z0-9.\-]+$/);
  });

  it("fills every tier", () => {
    for (const tier of TIER_ORDER) expect(modelsInTier(tier).length, tier).toBeGreaterThan(0);
  });
});

describe("tiers by plan", () => {
  it("gives each plan in the ladder at least what the plan below it has", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const below = modelsForPlan(PLAN_ORDER[i - 1]).map(m => m.id);
      const here = modelsForPlan(PLAN_ORDER[i]).map(m => m.id);
      expect(here).toEqual(expect.arrayContaining(below));
      expect(here.length).toBeGreaterThan(below.length);
    }
  });

  it("reaches the frontier only on pro", () => {
    expect(tiersForPlan("free")).toEqual(["fast"]);
    expect(tiersForPlan("plus")).toEqual(["fast", "capable"]);
    expect(tiersForPlan("pro")).toEqual(["fast", "capable", "frontier"]);
    expect(topTierForPlan("pro")).toBe("frontier");
  });

  it("covers every plan in the catalogue", () => {
    for (const id of Object.keys(PLANS) as PlanId[]) expect(modelsForPlan(id).length, id).toBeGreaterThan(0);
  });
});

describe("defaultModelForPlan", () => {
  it("picks a model that is in the plan's own tiers", () => {
    for (const id of PLAN_ORDER) {
      const chosen = defaultModelForPlan(id);
      expect(modelsForPlan(id).map(m => m.id), id).toContain(chosen);
    }
  });

  it("keeps free on a fast model, so today's behaviour is unchanged", () => {
    expect(modelById(defaultModelForPlan("free"))?.tier).toBe("fast");
  });

  it("climbs the ladder", () => {
    const out = (id: PlanId) => modelById(defaultModelForPlan(id))!.usdPerMillion.out;
    expect(out("plus")).toBeGreaterThan(out("free"));
    expect(out("pro")).toBeGreaterThan(out("plus"));
  });
});

describe("formatContext", () => {
  it("reads in the units a person uses", () => {
    expect(formatContext(1_000_000)).toBe("1M");
    expect(formatContext(400_000)).toBe("400K");
    expect(formatContext(128_000)).toBe("128K");
  });
});
