import { describe, expect, it } from "vitest";
import { topicSuggestions } from "./topics";
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
