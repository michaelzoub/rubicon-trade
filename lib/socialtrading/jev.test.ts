import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJev, jevModel } from "./jev";
import type { JevQuestion } from "./jev-types";

const choice: JevQuestion = { type: "choice", instructions: "Which area?", criteria: { ai: "AI", energy: "Energy" } };
const level: JevQuestion = { type: "score", instructions: "How supported?", criteria: ["none", "some", "lots"] };
const noul: JevQuestion = { type: "noul", instructions: "Urgent?", criteria: { true: "yes", false: "no" } };

const reply = (answers: unknown) => new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers }), { status: 200, headers: { "Content-Type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete process.env.JEV_MODEL; });

describe("askJev", () => {
  it("posts the state and questions to the decisions endpoint under the Jev slug", async () => {
    fetchMock.mockResolvedValue(reply({ p0: { type: "choice", choice: "ai", probabilities: { ai: 0.8, energy: 0.2 }, confidence: 0.76 } }));
    const answers = await askJev({ thesis: "AI needs power." }, { p0: choice });
    expect(answers).toEqual({ p0: { type: "choice", choice: "ai", probabilities: { ai: 0.8, energy: 0.2 }, confidence: 0.76 } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    expect(JSON.parse(init.body)).toEqual({ model: "typesafe/jev-1.13", state: { thesis: "AI needs power." }, questions: { p0: choice } });
  });

  it("rebuilds a score's legend from the levels that were asked about", async () => {
    fetchMock.mockResolvedValue(reply({ c0: { type: "score", score: 1.3, probabilities: { "1": 0.7, "2": 0.3 }, confidence: 0.6 } }));
    const answers = await askJev({}, { c0: level });
    expect(answers!.c0).toEqual({ type: "score", score: 1.3, legend: { "0": "none", "1": "some", "2": "lots" }, probabilities: { "1": 0.7, "2": 0.3 }, confidence: 0.6 });
  });

  it("clamps a score to the levels that exist and a confidence to 0-1", async () => {
    fetchMock.mockResolvedValue(reply({ c0: { type: "score", score: 99, confidence: 4 } }));
    const answers = await askJev({}, { c0: level });
    expect(answers!.c0).toMatchObject({ score: 2, confidence: 1, probabilities: {} });
  });

  it("reads a noul as a bare probability", async () => {
    fetchMock.mockResolvedValue(reply({ n0: { type: "noul", noul: 0.92 } }));
    expect((await askJev({}, { n0: noul }))!.n0).toEqual({ type: "noul", noul: 0.92 });
  });

  it("drops an answer that does not match the question that asked for it", async () => {
    fetchMock.mockResolvedValue(reply({
      p0: { type: "choice", choice: "healthcare", confidence: 1 }, // never offered
      p1: { type: "choice", confidence: 1 },                        // no choice at all
      c0: { type: "score", score: "high" },                         // not a number
      c1: "nonsense",
    }));
    expect(await askJev({}, { p0: choice, p1: choice, c0: level, c1: level })).toEqual({});
  });

  it("survives a reply with no answers at all", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await askJev({}, { p0: choice })).toEqual({});
  });

  it("splits a large fan-out across concurrent requests and merges what comes back", async () => {
    const questions = Object.fromEntries(Array.from({ length: 95 }, (_, i) => [`c${i}`, level]));
    fetchMock.mockImplementation((_url: string, init: { body: string }) => {
      const sent = JSON.parse(init.body).questions as Record<string, unknown>;
      return Promise.resolve(reply(Object.fromEntries(Object.keys(sent).map(id => [id, { type: "score", score: 1, confidence: 0.5 }]))));
    });
    const answers = await askJev({}, questions);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(Object.keys(answers!)).toHaveLength(95);
  });

  it("keeps the batches that answered when one of them fails", async () => {
    const questions = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`c${i}`, level]));
    fetchMock
      .mockResolvedValueOnce(reply({ c0: { type: "score", score: 2, confidence: 1 } }))
      .mockResolvedValueOnce(new Response("upstream is busy", { status: 503 }));
    const answers = await askJev({}, questions);
    expect(Object.keys(answers!)).toEqual(["c0"]);
  });

  it("returns null — not an empty answer — when nothing could be reached", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    expect(await askJev({}, { c0: level })).toBeNull();
  });

  it("returns null rather than throwing when the deployment has no key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await askJev({}, { c0: level })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call out at all when there is nothing to ask", async () => {
    expect(await askJev({}, {})).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets a deployment pin a different Jev without a code change", () => {
    expect(jevModel()).toBe("typesafe/jev-1.13");
    process.env.JEV_MODEL = "typesafe/jev-2.0";
    expect(jevModel()).toBe("typesafe/jev-2.0");
  });
});
