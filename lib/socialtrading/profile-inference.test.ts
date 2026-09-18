import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BELIEF_LEVELS, beliefQuestions, inferBeliefs } from "./profile-inference";
import { advanceProfile } from "./profile-turn";
import { PROBE_TOPICS } from "./profile-topics";
import { newProfileModel, type Belief, type Evidence, type ProfileModel } from "./profile-model";
import { newOnboarding } from "./onboarding";

const evidence: Evidence[] = [{
  id: "probe:ai-applications", at: "2026-09-18T10:00:00.000Z", kind: "choice",
  prompt: "AI takes over more work than it creates.", topics: ["ai-applications"],
  answer: { kind: "binary", direction: "yes" },
}];

const reply = (answers: unknown) => new Response(JSON.stringify({ answers }), { status: 200, headers: { "Content-Type": "application/json" } });
const score = (value: number, confidence: number) => ({ type: "score", score: value, confidence });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("reading the evidence", () => {
  it("asks one ordered score per topic, never a bare probability", () => {
    const questions = beliefQuestions();
    expect(Object.keys(questions).sort()).toEqual(PROBE_TOPICS.map(t => t.id).sort());
    for (const question of Object.values(questions)) {
      expect(question.type).toBe("score");
      expect((question as { criteria: string[] }).criteria).toEqual(BELIEF_LEVELS);
    }
    expect(BELIEF_LEVELS).toHaveLength(5);
  });

  it("sends the raw evidence and the foundations, and never the previous beliefs", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await inferBeliefs(evidence, { confidence: 2, knowledge: 1 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state.evidence).toEqual(evidence);
    expect(body.state.foundations).toEqual({ confidence: 2, knowledge: 1 });
    expect(body.state).not.toHaveProperty("beliefs");
  });

  it("turns a score into a probability and keeps the confidence as certainty", async () => {
    fetchMock.mockResolvedValue(reply({ "ai-applications": score(4, 0.82), "consumer-trends": score(0, 0.4), robotics: score(2, 0.5) }));
    const beliefs = await inferBeliefs(evidence, { confidence: 2, knowledge: 1 });
    expect(beliefs).toHaveLength(3);
    expect(beliefs).toEqual(expect.arrayContaining([
      { topic: "ai-applications", p: 1, certainty: 0.82 },
      { topic: "consumer-trends", p: 0, certainty: 0.4 },
      { topic: "robotics", p: 0.5, certainty: 0.5 },
    ]));
  });

  it("drops a topic Jev did not answer rather than inventing a reading for it", async () => {
    fetchMock.mockResolvedValue(reply({ robotics: score(3, 0.6) }));
    expect(await inferBeliefs(evidence, { confidence: 1, knowledge: 1 })).toEqual([{ topic: "robotics", p: 0.75, certainty: 0.6 }]);
  });

  it("returns null when Jev cannot be reached, so the caller keeps what it had", async () => {
    fetchMock.mockRejectedValue(new Error("upstream down"));
    expect(await inferBeliefs(evidence, { confidence: 1, knowledge: 1 })).toBeNull();
  });
});

const ctx = { knowledge: 1, confidence: 1, answers: newOnboarding() };
const read: Belief[] = [
  { topic: "semiconductors", p: 0.8, certainty: 0.4 },
  { topic: "power-grid", p: 0.7, certainty: 0.4 },
  { topic: "ai-applications", p: 0.6, certainty: 0.4 },
];

describe("advancing a turn", () => {
  it("replaces the beliefs wholesale and marks the reading as the model's", async () => {
    const stale: ProfileModel = { ...newProfileModel(), beliefs: [{ topic: "biotech", p: 0.9, certainty: 0.9 }], source: "jev" };
    const { model, probe } = await advanceProfile(stale, ctx, async () => read);
    expect(model.beliefs).toEqual(read);
    expect(model.source).toBe("jev");
    expect(probe).not.toBeNull();
  });

  it("keeps the previous beliefs and goes pending when Jev is unreachable", async () => {
    const had: ProfileModel = { ...newProfileModel(), beliefs: read, source: "jev", turn: 1 };
    const { model, probe } = await advanceProfile(had, ctx, async () => null);
    expect(model.beliefs).toEqual(read);
    expect(model.source).toBe("pending");
    expect(probe).not.toBeNull();
  });

  it("never edits the evidence log while reading it", async () => {
    const start = { ...newProfileModel(), evidence };
    const { model } = await advanceProfile(start, ctx, async () => read);
    expect(model.evidence).toEqual(start.evidence);
  });

  it("reports the end of the run as a null probe rather than an error", async () => {
    const done: ProfileModel = { ...newProfileModel(), beliefs: read, source: "jev", turn: 7 };
    expect((await advanceProfile(done, ctx, async () => read)).probe).toBeNull();
  });
});
