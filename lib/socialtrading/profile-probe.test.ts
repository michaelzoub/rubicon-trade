import { describe, expect, it } from "vitest";
import { MAX_PROBES, MIN_PROBES, SPECTRUM_STOPS, getNextProfileProbe, probeId, rankTopics, type ProbeContext } from "./profile-probe";
import { newProfileModel, type Belief, type Evidence, type ProfileModel } from "./profile-model";
import { newOnboarding } from "./onboarding";

const model = (beliefs: Belief[], patch: Partial<ProfileModel> = {}): ProfileModel =>
  ({ ...newProfileModel(), source: "jev", beliefs, ...patch });

const ctx = (patch: Partial<ProbeContext> = {}): ProbeContext =>
  ({ knowledge: 1, confidence: 1, answers: newOnboarding(), ...patch });

const spent = (kind: Evidence["kind"], id: string): Evidence =>
  ({ id, at: "2026-09-18T10:00:00.000Z", kind, prompt: "asked", topics: ["robotics"], answer: { kind: "binary", direction: "yes" } });

/**
 * Four low-value beliefs. They are filler: each test's own topic is the one
 * that should win the ranking, and these only make the field realistic. Their
 * values are spread apart deliberately, so the chips rule (top three within
 * 15%) does not fire by accident. All four sit in domains no test touches, so
 * the funnel's novelty term applies to them uniformly and cannot reorder them.
 *
 *   medical-technology  0.5 * 0.64 * 0.50 = 0.160
 *   future-of-work     0.45 * 0.64 * 0.50 = 0.144
 *   consumer-trends     0.4 * 0.60 * 0.35 = 0.084
 *   decentralized-fin.  0.3 * 0.52 * 0.45 = 0.070
 */
const settled: Belief[] = [
  { topic: "medical-technology", p: 0.5, certainty: 0.9 },
  { topic: "future-of-work", p: 0.45, certainty: 0.75 },
  { topic: "consumer-trends", p: 0.4, certainty: 0.7 },
  { topic: "decentralized-finance", p: 0.3, certainty: 0.6 },
];

describe("ranking the next topic", () => {
  it("suppresses a topic the evidence says they do not care about", () => {
    const ranked = rankTopics(model([
      { topic: "cloud-software", p: 0.10, certainty: 0.5 },
      { topic: "semiconductors", p: 0.85, certainty: 0.5 },
    ]));
    expect(ranked.map(c => c.topic.id)).toEqual(["semiconductors"]);
  });

  it("skips a topic we already know with confidence, and keeps the same reading when we do not", () => {
    expect(rankTopics(model([{ topic: "semiconductors", p: 0.9, certainty: 0.9 }]))).toEqual([]);
    expect(rankTopics(model([{ topic: "semiconductors", p: 0.9, certainty: 0.5 }])).map(c => c.topic.id)).toEqual(["semiconductors"]);
  });

  it("does not skip a confident reading that sits in the middle — that is not knowing", () => {
    expect(rankTopics(model([{ topic: "semiconductors", p: 0.55, certainty: 0.95 }])).map(c => c.topic.id)).toEqual(["semiconductors"]);
  });

  it("never returns a topic already asked about", () => {
    const beliefs: Belief[] = [{ topic: "semiconductors", p: 0.7, certainty: 0.4 }];
    expect(rankTopics(model(beliefs, { asked: [probeId("semiconductors")] }))).toEqual([]);
  });

  it("prefers the uncertain topic over the settled one when both are wanted", () => {
    const ranked = rankTopics(model([
      { topic: "semiconductors", p: 0.55, certainty: 0.2 },
      { topic: "ai-applications", p: 0.55, certainty: 0.75 },
    ]));
    expect(ranked[0].topic.id).toBe("semiconductors");
  });

  it("lets importance break a tie between two equally uncertain topics", () => {
    const ranked = rankTopics(model([
      { topic: "consumer-trends", p: 0.5, certainty: 0.3 },
      { topic: "ai-applications", p: 0.5, certainty: 0.3 },
    ]));
    expect(ranked[0].topic.id).toBe("ai-applications");
  });

  it("computes value as relevance times uncertainty times importance", () => {
    const [candidate] = rankTopics(model([{ topic: "semiconductors", p: 0.5, certainty: 0.5 }]));
    // spread 1, doubt 0.5 -> uncertainty 0.8; value 0.5 * 0.8 * 0.95
    expect(candidate.value).toBeCloseTo(0.38, 6);
  });

  it("ignores a belief about a topic the catalog no longer has", () => {
    expect(rankTopics(model([{ topic: "sports", p: 0.9, certainty: 0.1 } as unknown as Belief]))).toEqual([]);
  });
});

describe("choosing the next probe", () => {
  it("stops at the ceiling however unsure it still is", () => {
    expect(getNextProfileProbe(model(settled, { turn: MAX_PROBES }), ctx())).toBeNull();
  });

  it("keeps asking below the floor even when nothing clears the threshold", () => {
    const thin: Belief[] = [{ topic: "consumer-trends", p: 0.16, certainty: 0.79 }];
    expect(getNextProfileProbe(model(thin, { turn: MIN_PROBES - 1 }), ctx())).not.toBeNull();
    expect(getNextProfileProbe(model(thin, { turn: MIN_PROBES }), ctx())).toBeNull();
  });

  it("stops when every topic is suppressed or already known", () => {
    expect(getNextProfileProbe(model([{ topic: "semiconductors", p: 0.05, certainty: 0.2 }], { turn: 1 }), ctx())).toBeNull();
  });

  it("opens wide: the first probes are always a swipe, whatever the readings say", () => {
    const probe = getNextProfileProbe(model([{ topic: "semiconductors", p: 0.6, certainty: 0.4 }]), ctx());
    expect(probe).toMatchObject({ kind: "choice", topics: ["semiconductors"], category: "Technology" });
  });

  it("puts a map in front of a geographic topic, once", () => {
    // 0.95 * 0.44 * 0.8 = 0.334, comfortably above every settled belief.
    const geo: Belief[] = [...settled, { topic: "defence-sovereignty", p: 0.95, certainty: 0.05 }];
    expect(getNextProfileProbe(model(geo, { turn: 2 }), ctx())).toMatchObject({ kind: "map", topics: ["defence-sovereignty"] });
    expect(getNextProfileProbe(model(geo, { turn: 2, evidence: [spent("map", "probe:climate-adaptation")] }), ctx())!.kind).not.toBe("map");
  });

  it("asks how strongly when direction is read but strength is not", () => {
    // 0.85 * 0.44 * 0.75 = 0.281, the top candidate.
    const leaning: Belief[] = [...settled, { topic: "robotics", p: 0.85, certainty: 0.35 }];
    const probe = getNextProfileProbe(model(leaning, { turn: 2 }), ctx());
    expect(probe).toMatchObject({ kind: "spectrum", topics: ["robotics"] });
    expect(probe!.options).toEqual(SPECTRUM_STOPS);
    expect(probe!.options).toHaveLength(4);
  });

  it("asks for conviction and horizon once a view is settled and no horizon exists", () => {
    // 0.78 * 0.384 * 0.75 = 0.225, the top candidate.
    const strong: Belief[] = [...settled, { topic: "robotics", p: 0.78, certainty: 0.7 }];
    expect(getNextProfileProbe(model(strong, { turn: 4 }), ctx())).toMatchObject({ kind: "pad", topics: ["robotics"] });
  });

  it("does not ask for a horizon that onboarding already has", () => {
    const strong: Belief[] = [...settled, { topic: "robotics", p: 0.78, certainty: 0.7 }];
    const answers = { ...newOnboarding(), responses: [{ id: "r", category: "Technology", text: "t", direction: "yes" as const, years: 5 }] };
    expect(getNextProfileProbe(model(strong, { turn: 4 }), ctx({ answers }))!.kind).not.toBe("pad");
  });

  it("lets the person break a three-way tie with chips", () => {
    const tied: Belief[] = [
      { topic: "semiconductors", p: 0.6, certainty: 0.4 },
      { topic: "ai-applications", p: 0.6, certainty: 0.4 },
      { topic: "power-grid", p: 0.62, certainty: 0.4 },
      { topic: "consumer-trends", p: 0.2, certainty: 0.9 },
    ];
    const probe = getNextProfileProbe(model(tied, { turn: 2 }), ctx());
    expect(probe!.kind).toBe("chips");
    expect(probe!.topics).toHaveLength(3);
    expect(probe!.options).toHaveLength(3);
  });

  it("gives a knowledgeable person the last word in their own words", () => {
    const probe = getNextProfileProbe(model(settled, { turn: 4 }), ctx({ knowledge: 3 }));
    expect(probe!.kind).toBe("text");
  });

  it("picks the claim at the person's knowledge level", () => {
    const one: Belief[] = [{ topic: "robotics", p: 0.6, certainty: 0.4 }];
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 0 }))!.title).toBe("By 2035, robots take more physical jobs than they create.");
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 3 }))!.title).toBe("By 2035, robotics changes the physical economy more than AI changes office work.");
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 9 }))!.title).toBe("By 2035, robotics changes the physical economy more than AI changes office work.");
  });

  it("walks the seven domains in order when the model never answered", () => {
    const pending = { ...newProfileModel(), turn: 0 };
    const first = getNextProfileProbe(pending, ctx());
    expect(first).toMatchObject({ kind: "choice", category: "Technology" });
    const second = getNextProfileProbe({ ...pending, turn: 1, evidence: [{ ...spent("choice", first!.id), topics: first!.topics }] }, ctx());
    expect(second!.category).toBe("Energy");
  });
});

describe("the funnel", () => {
  it("keeps the opening probes broad even when a sharper instrument would fit", () => {
    // A geographic topic at a lopsided reading would take the map immediately
    // if the stages did not exist.
    const geo: Belief[] = [...settled, { topic: "defence-sovereignty", p: 0.95, certainty: 0.05 }];
    expect(getNextProfileProbe(model(geo, { turn: 0 }), ctx())!.kind).toBe("choice");
    expect(getNextProfileProbe(model(geo, { turn: 1 }), ctx())!.kind).toBe("choice");
    expect(getNextProfileProbe(model(geo, { turn: 2 }), ctx())!.kind).toBe("map");
  });

  it("holds conviction and freeform back until the shape is known", () => {
    const strong: Belief[] = [...settled, { topic: "robotics", p: 0.78, certainty: 0.7 }];
    expect(getNextProfileProbe(model(strong, { turn: 3 }), ctx({ knowledge: 3 }))!.kind).not.toBe("pad");
    expect(getNextProfileProbe(model(strong, { turn: 4 }), ctx({ knowledge: 3 }))!.kind).toBe("pad");
  });

  it("spreads early, then digs into the domains already engaged with", () => {
    const beliefs: Belief[] = [
      { topic: "semiconductors", p: 0.6, certainty: 0.4 },   // Technology
      { topic: "power-grid", p: 0.6, certainty: 0.4 },       // Energy
    ];
    const asked: Evidence = { ...spent("choice", "probe:data-centers"), topics: ["data-centers"] }; // Technology
    // Early: Energy is untouched, so it outranks the Technology sibling.
    expect(rankTopics({ ...model(beliefs, { turn: 1, evidence: [asked] }) })[0].topic.id).toBe("power-grid");
    // Late: the same evidence now pulls back toward the touched domain.
    expect(rankTopics({ ...model(beliefs, { turn: 6, evidence: [asked] }) })[0].topic.id).toBe("semiconductors");
  });

  it("never lets the funnel resurrect a topic the evidence suppressed", () => {
    const beliefs: Belief[] = [{ topic: "cloud-software", p: 0.05, certainty: 0.3 }];
    expect(rankTopics(model(beliefs, { turn: 0 }))).toEqual([]);
    expect(rankTopics(model(beliefs, { turn: 6 }))).toEqual([]);
  });
});
