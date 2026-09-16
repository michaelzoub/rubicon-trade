import { describe, expect, it, vi } from "vitest";
import { newProfile } from "../profile";
import type { HubState } from "../types";

vi.mock("../providers/market-data", () => ({ marketData: {} }));
vi.mock("../providers/crypto-data", () => ({ cryptoData: {} }));
vi.mock("../providers/brokerage", () => ({ brokerage: {}, BrokerageNotConnected: class extends Error {} }));
vi.mock("../server", () => ({ HubError: class HubError extends Error {}, database: vi.fn() }));
import { applyProfileUpdate, profileSummary } from "./tools";

const hub = (): HubState => ({ revision: 0, profile: { ...newProfile("alice"), thesis: "Energy", themes: ["energy"], interests: [{ id: "NVDA", symbol: "NVDA", name: "Nvidia", kind: "stock" }], permission: "approve", permissionConfigured: true, step: 6, completedAt: "2026-09-14T00:00:00Z" }, dislikes: [], preferences: [], inferred: [], signals: [], chats: [], events: [], trades: [] });

describe("update_profile tool", () => {
  it("applies explicit changes and reports each one", () => {
    const state = hub();
    const { changes } = applyProfileUpdate(state, { add_preferences: ["nuclear"], add_dislikes: ["memecoins"], add_interests: [{ symbol: "vrt", name: "Vertiv", kind: "stock" }, { name: "Bitcoin", kind: "crypto" }], remove_interests: ["nvda"], add_themes: ["ai", "bogus"] });
    expect(state.preferences).toEqual(["nuclear"]);
    expect(state.dislikes).toEqual(["memecoins"]);
    expect(state.profile.interests.map(i => i.id)).toEqual(["VRT", "bitcoin"]);
    expect(state.profile.themes).toEqual(["energy", "ai"]);
    expect(changes.map(c => c.label)).toEqual(["Core interests", "Paying attention to", "Paying attention to", "Paying attention to", "Things you care about", "Show me less"]);
    expect(state.events.at(-1)?.kind).toBe("profile");
    expect(applyProfileUpdate(state, { add_preferences: ["Nuclear"] })).toEqual({ changes: [], skipped: [] });
  });
  it("validates limits and mode changes", () => {
    const state = hub();
    expect(() => applyProfileUpdate(state, { limits: { daily: "200" } })).toThrow(/positive USD/);
    const { changes } = applyProfileUpdate(state, { permission: "automatic", limits: { perTrade: "$50", daily: 200, weekly: "1000" } });
    expect(state.profile.permission).toBe("automatic");
    expect(state.profile.limits).toEqual({ perTrade: "50", daily: "200.00", weekly: "1000" });
    expect(changes.find(c => c.field === "permission")?.after).toBe("Act within my limits");
    expect(profileSummary(state).permissions).toMatch(/\$50 per trade/);
  });
  it("gives the agent the adaptive onboarding path in plain language", () => {
    const state = hub();
    state.profile.investorAnswers = { knowledge: 1, guidedTest: true, opportunityDrivers: ["Human progress"], esgPriority: 4, aiPriority: 3, technologies: ["AI safety"], conflictCountries: ["Ukraine"], geopoliticalThesis: "Energy security becomes essential", futureVision: "AI safety will become essential infrastructure" };
    expect(profileSummary(state).onboarding).toEqual({
      investmentKnowledge: "knows the basics", opportunityDrivers: ["Human progress"], ethicsAndImpact: "impact first", aiPriority: "a lot",
      technologies: ["AI safety"], fiveToTenYearView: "AI safety will become essential infrastructure",
      geopoliticalOutlook: { countries: ["Ukraine"], thesis: "Energy security becomes essential" },
    });
  });
});
