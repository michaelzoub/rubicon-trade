import { describe, expect, it } from "vitest";
import { TOPICS, classifyTopic, topicSuggestions } from "./topics";
import { topicRecommendations } from "./suggestions";
import { GET } from "@/app/api/trade/interests/route";

describe("onboarding interest discovery", () => {
  it("suggests only high-level interests, including when searching asset names", () => {
    for (const query of ["", "AI", "bitcoin", "Nvidia"]) {
      expect(topicSuggestions(["ai", "energy"], "AI inference and power", query).every(i => i.kind === "custom" && !i.symbol)).toBe(true);
    }
    expect(topicSuggestions(["ai", "energy"], "AI inference and power").slice(0, 5).map(i => i.name)).toContain("Power infrastructure");
  });
  it("maps exact topics without leaking unrelated same-sector assets", () => {
    expect(topicRecommendations({ id: "theme:power-grid", name: "Power infrastructure" }).map(i => i.symbol)).toEqual(["CEG"]);
    expect(topicRecommendations({ id: "theme:decentralized-finance", name: "Decentralized finance" }).map(i => i.symbol)).toEqual(["ETH"]);
  });
  it("classifies custom interests and leaves unknown interests unmatched", () => {
    expect(topicRecommendations({ id: "custom:new", name: "GPU demand" }).map(i => i.symbol)).toEqual(["NVDA"]);
    expect(topicRecommendations({ id: "custom:new", name: "Ocean conservation" })).toEqual([]);
  });
  it("serves previews before onboarding completion and validates input", async () => {
    const response = await GET(new Request("http://localhost/api/trade/interests?name=Semiconductors"));
    expect(response.status).toBe(200);
    expect((await response.json()).recommendations[0].symbol).toBe("NVDA");
    expect((await GET(new Request("http://localhost/api/trade/interests?name="))).status).toBe(400);
    expect((await GET(new Request(`http://localhost/api/trade/interests?name=${"x".repeat(101)}`))).status).toBe(400);
  });
});

describe("the onboarding topics", () => {
  it("covers the five domains onboarding asks about that discovery lacked", () => {
    const ids = TOPICS.map(t => t.id);
    expect(ids).toEqual(expect.arrayContaining(["robotics", "defence-sovereignty", "climate-adaptation", "stablecoins", "future-of-work"]));
  });

  it("keeps every topic well formed, so a new entry cannot half-exist", () => {
    for (const topic of TOPICS) {
      expect(topic.id).toMatch(/^[a-z-]+$/);
      expect(topic.name.length).toBeGreaterThan(0);
      expect(topic.themes.length).toBeGreaterThan(0);
      expect(topic.assets.length).toBeGreaterThan(0);
    }
    expect(new Set(TOPICS.map(t => t.id)).size).toBe(TOPICS.length);
  });

  it("routes the new topics through the existing keyword classifier", () => {
    expect(classifyTopic({ id: "x", name: "Robotics and automation" }).map(t => t.id)).toContain("robotics");
    expect(classifyTopic({ id: "x", name: "Stablecoin payments" }).map(t => t.id)).toContain("stablecoins");
  });

  it("keeps climate adaptation out of results for unrelated infrastructure", () => {
    // `classifyTopic` returns every match, so a bare `infrastructure`
    // alternative would tag the power-grid topic's own name as climate.
    expect(classifyTopic({ id: "x", name: "Power infrastructure" }).map(t => t.id)).not.toContain("climate-adaptation");
    expect(classifyTopic({ id: "x", name: "cloud infrastructure" }).map(t => t.id)).not.toContain("climate-adaptation");
    expect(classifyTopic({ id: "x", name: "Climate adaptation" }).map(t => t.id)).toContain("climate-adaptation");
    expect(classifyTopic({ id: "x", name: "flood defences" }).map(t => t.id)).toContain("climate-adaptation");
  });
});
