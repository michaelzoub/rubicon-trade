import { describe, expect, it } from "vitest";
import { MAX_EVIDENCE, newProfileModel, readProfileModel, recordEvidence, type Evidence, type ProfileModel } from "./profile-model";

const entry = (id: string): Evidence => ({
  id, at: "2026-09-18T10:00:00.000Z", kind: "choice", prompt: "Robots take more physical jobs than they create.",
  topics: ["robotics"], answer: { kind: "binary", direction: "yes" },
});

describe("the profile model", () => {
  it("starts empty and pending, because nothing has been read yet", () => {
    expect(newProfileModel()).toEqual({ version: 1, evidence: [], beliefs: [], asked: [], turn: 0, source: "pending" });
  });

  it("records an answer without touching what was inferred", () => {
    const start: ProfileModel = { ...newProfileModel(), beliefs: [{ topic: "robotics", p: 0.8, certainty: 0.7 }], source: "jev" };
    const next = recordEvidence(start, entry("probe:robotics"));
    expect(next.evidence).toEqual([entry("probe:robotics")]);
    expect(next.asked).toEqual(["probe:robotics"]);
    expect(next.turn).toBe(1);
    expect(next.beliefs).toEqual(start.beliefs);
    expect(start.evidence).toEqual([]);
  });

  it("caps the evidence log so a long run cannot grow without bound", () => {
    let model = newProfileModel();
    for (let i = 0; i < MAX_EVIDENCE + 5; i++) model = recordEvidence(model, entry(`probe:${i}`));
    expect(model.evidence).toHaveLength(MAX_EVIDENCE);
    expect(model.evidence[0].id).toBe("probe:5");
    expect(model.turn).toBe(MAX_EVIDENCE + 5);
  });

  it("reads a well-formed stored model back", () => {
    const stored = recordEvidence({ ...newProfileModel(), beliefs: [{ topic: "robotics", p: 0.8, certainty: 0.7 }], source: "jev" }, entry("probe:robotics"));
    expect(readProfileModel(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it("refuses anything that is not this version of the model", () => {
    expect(readProfileModel(null)).toBeUndefined();
    expect(readProfileModel("a string")).toBeUndefined();
    expect(readProfileModel({ ...newProfileModel(), version: 2 })).toBeUndefined();
  });

  it("drops beliefs about topics that no longer exist and clamps the numbers", () => {
    const read = readProfileModel({
      ...newProfileModel(),
      beliefs: [
        { topic: "sports", p: 0.5, certainty: 0.5 },
        { topic: "robotics", p: 5, certainty: -2 },
        { topic: "semiconductors", p: "high", certainty: 0.4 },
      ],
    });
    expect(read!.beliefs).toEqual([{ topic: "robotics", p: 1, certainty: 0 }]);
  });

  it("drops evidence it cannot trust and truncates an over-long prompt", () => {
    const read = readProfileModel({
      ...newProfileModel(),
      evidence: [
        { ...entry("a"), kind: "telepathy" },
        { ...entry("b"), topics: ["sports"] },
        { ...entry("c"), prompt: "x".repeat(400) },
      ],
    });
    expect(read!.evidence.map(e => e.id)).toEqual(["c"]);
    expect(read!.evidence[0].prompt).toHaveLength(300);
  });

  it("keeps source honest: an unrecognised source is pending, never jev", () => {
    expect(readProfileModel({ ...newProfileModel(), source: "guesswork" })!.source).toBe("pending");
    expect(readProfileModel({ ...newProfileModel(), source: "jev" })!.source).toBe("jev");
  });
});
