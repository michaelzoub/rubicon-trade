import { describe, expect, it } from "vitest";
import { loadRuns, newRun, saveRun, summarize, RUNS_KEY, type Run } from "./onboarding-metrics";

function store() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, raw: map };
}
const run = (over: Partial<Run> = {}): Run => ({ ...newRun(over.id ?? crypto.randomUUID(), over.variant ?? "tree", false, "tree"), ...over });

describe("onboarding run log", () => {
  it("upserts by id so an advancing run is rewritten, not duplicated", () => {
    const s = store();
    const r = run({ id: "r1" });
    saveRun(r, s);
    saveRun({ ...r, backs: 3 }, s);
    const loaded = loadRuns(s);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].backs).toBe(3);
  });

  it("survives absent, malformed, and partly invalid storage", () => {
    expect(loadRuns(store())).toEqual([]);
    const broken = store(); broken.setItem(RUNS_KEY, "{not json");
    expect(loadRuns(broken)).toEqual([]);
    const mixed = store();
    mixed.setItem(RUNS_KEY, JSON.stringify([{ id: "ok", variant: "tree" }, { id: "bad", variant: "chat" }, null, 7]));
    expect(loadRuns(mixed).map(r => r.id)).toEqual(["ok"]);
  });

  it("does not throw when storage is unavailable", () => {
    const hostile = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveRun(run(), hostile)).not.toThrow();
    expect(loadRuns(hostile)).toEqual([]);
  });

  it("keeps forced runs out of the rates but still loads them", () => {
    const runs = [
      run({ variant: "tree", completed: true }),
      run({ variant: "tree", completed: false, abandonedAt: "scene-2" }),
      run({ variant: "tree", completed: false, forced: true }),
    ];
    const s = summarize(runs, "tree");
    expect(s.runs).toBe(2);
    expect(s.completed).toBe(1);
    expect(s.completionRate).toBe(.5);
    expect(s.dropOff).toEqual({ "scene-2": 1 });
  });

  it("does not count a fallback run as inference — that would compare the tree with itself", () => {
    const runs = [
      run({ variant: "inference", source: "model", completed: true }),
      run({ variant: "inference", source: "fallback", completed: true }),
    ];
    expect(summarize(runs, "inference").runs).toBe(1);
  });

  it("reports median duration and card count across completed runs only", () => {
    const card = (ms: number) => ({ id: "c", kind: "binary", ms, revisits: 0 });
    const runs = [
      run({ variant: "tree", completed: true, cards: [card(1000), card(3000)] }),
      run({ variant: "tree", completed: true, cards: [card(2000), card(4000), card(2000)] }),
      run({ variant: "tree", completed: false, cards: [card(99000)] }),
    ];
    const s = summarize(runs, "tree");
    expect(s.medianMs).toBe(6000);
    expect(s.medianCards).toBe(3);
  });

  it("reports nothing rather than dividing by zero for an arm with no runs", () => {
    const s = summarize([], "inference");
    expect(s).toMatchObject({ runs: 0, completed: 0, completionRate: 0, medianMs: 0, medianCards: 0 });
  });
});
