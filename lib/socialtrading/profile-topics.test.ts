import { describe, expect, it } from "vitest";
import { PROBE_TOPICS, isTopicId, probeTopic, topicName } from "./profile-topics";
import { TOPICS } from "./topics";
import { CATEGORIES } from "./onboarding";

describe("probe topics", () => {
  it("names a real catalog topic and a real domain for every entry", () => {
    for (const topic of PROBE_TOPICS) {
      expect(TOPICS.some(t => t.id === topic.id)).toBe(true);
      expect(CATEGORIES).toContain(topic.category);
    }
  });

  it("covers the catalog exactly once, so no topic is scored twice or missed", () => {
    expect(PROBE_TOPICS.map(t => t.id).sort()).toEqual(TOPICS.map(t => t.id).sort());
  });

  it("covers all seven domains, so an adaptive profile is still readable as coverage", () => {
    expect([...new Set(PROBE_TOPICS.map(t => t.category))].sort()).toEqual([...CATEGORIES].sort());
  });

  it("carries exactly four claims, one per knowledge level, each a real sentence", () => {
    for (const topic of PROBE_TOPICS) {
      expect(topic.claims).toHaveLength(4);
      for (const claim of topic.claims) {
        expect(claim.length).toBeGreaterThan(20);
        expect(claim.length).toBeLessThanOrEqual(140);
      }
    }
  });

  it("keeps importance a usable weight rather than a flat prior", () => {
    for (const topic of PROBE_TOPICS) {
      expect(topic.importance).toBeGreaterThan(0);
      expect(topic.importance).toBeLessThanOrEqual(1);
    }
    expect(new Set(PROBE_TOPICS.map(t => t.importance)).size).toBeGreaterThan(1);
  });

  it("marks the topics a map answers better than a statement", () => {
    expect(PROBE_TOPICS.filter(t => t.geographic).map(t => t.id).sort()).toEqual(["climate-adaptation", "defence-sovereignty"]);
  });

  it("looks a topic up and names it", () => {
    expect(probeTopic("semiconductors")?.category).toBe("Technology");
    expect(probeTopic("not-a-topic")).toBeUndefined();
    expect(topicName("semiconductors")).toBe("Semiconductors");
    expect(isTopicId("semiconductors")).toBe(true);
    expect(isTopicId("sports")).toBe(false);
  });
});
