import { describe, expect, it } from "vitest";
import { AGENT_LABEL, agentState, along, arc, bowAway, chooseRegion, dwellSeconds, keepToGutter, travelSeconds, type AgentSituation } from "./agent-state";

const quiet: AgentSituation = { open: false, busy: false, streaming: false, waiting: false, discovery: false, attending: false, reflecting: false };

describe("agentState", () => {
  it("is idle when nothing is happening", () => {
    expect(agentState(quiet)).toBe("idle");
  });

  it("puts talking with the person above everything else", () => {
    expect(agentState({ ...quiet, open: true, waiting: true, busy: true, discovery: true })).toBe("interacting");
  });

  it("carries a blocked decision ahead of its own work", () => {
    expect(agentState({ ...quiet, waiting: true, busy: true, discovery: true })).toBe("wanting");
  });

  it("thinks while working and interacts once words arrive", () => {
    expect(agentState({ ...quiet, busy: true })).toBe("thinking");
    expect(agentState({ ...quiet, busy: true, streaming: true })).toBe("interacting");
  });

  it("shows a discovery ahead of merely watching", () => {
    expect(agentState({ ...quiet, discovery: true, attending: true })).toBe("discovering");
  });

  it("observes both when the person reads something and when it has just learned", () => {
    expect(agentState({ ...quiet, attending: true })).toBe("observing");
    expect(agentState({ ...quiet, reflecting: true })).toBe("observing");
  });

  it("names every state it can reach", () => {
    for (const state of ["idle", "observing", "thinking", "discovering", "wanting", "interacting"] as const) {
      expect(AGENT_LABEL[state]).toBeTruthy();
    }
  });
});

describe("travelSeconds", () => {
  it("moves slowly, and more slowly again while the person writes", () => {
    expect(travelSeconds(0, "idle", false)).toBeGreaterThanOrEqual(6);
    expect(travelSeconds(900, "idle", false)).toBeLessThanOrEqual(14);
    expect(travelSeconds(400, "idle", true)).toBeGreaterThan(travelSeconds(400, "idle", false));
  });

  it("hurries for a discovery and for something that needs the person", () => {
    expect(travelSeconds(400, "discovering", false)).toBeLessThan(travelSeconds(400, "idle", false));
    expect(travelSeconds(400, "wanting", false)).toBeLessThan(travelSeconds(400, "idle", false));
  });
});

describe("dwellSeconds", () => {
  it("stays put while it is with the person or waiting on them", () => {
    expect(dwellSeconds("interacting", 0.5)).toBe(Infinity);
    expect(dwellSeconds("wanting", 0.5)).toBe(Infinity);
  });

  it("rests for a few seconds otherwise, and less when curious", () => {
    expect(dwellSeconds("idle", 0)).toBe(4);
    expect(dwellSeconds("idle", 1)).toBe(10);
    expect(dwellSeconds("discovering", 0)).toBeLessThan(dwellSeconds("idle", 0));
  });
});

describe("chooseRegion", () => {
  const regions = [
    { id: "a", x: 0, y: 0, weight: 1 },
    { id: "b", x: 10, y: 0, weight: 3 },
  ];

  it("returns nothing when there is nowhere to go", () => {
    expect(chooseRegion([], 0.5)).toBeNull();
    expect(chooseRegion([{ id: "a", x: 0, y: 0, weight: 0 }], 0.5)).toBeNull();
  });

  it("favours the heavier region across the roll", () => {
    const picks = Array.from({ length: 100 }, (_, i) => chooseRegion(regions, i / 100)!.id);
    expect(picks.filter(id => id === "b").length).toBeGreaterThan(picks.filter(id => id === "a").length);
  });

  it("always goes somewhere else when it can", () => {
    for (let i = 0; i < 20; i++) expect(chooseRegion(regions, i / 20, "b")!.id).toBe("a");
  });

  it("stays where it is rather than stopping when nowhere else is offered", () => {
    expect(chooseRegion([regions[1]], 0.5, "b")!.id).toBe("b");
  });

  it("handles a roll at either end without falling off the list", () => {
    expect(chooseRegion(regions, 0)).not.toBeNull();
    expect(chooseRegion(regions, 1)).not.toBeNull();
  });
});

describe("arc", () => {
  it("bows off the straight line so the path is not an interpolation", () => {
    const [start, control, end] = arc({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 100, y: 0 });
    expect(control.x).toBe(50);
    expect(control.y).not.toBe(0);
  });

  it("bows to the same side however the journey is oriented", () => {
    expect(arc({ x: 0, y: 0 }, { x: 0, y: 100 })[1].x).toBeLessThan(0);
    expect(arc({ x: 0, y: 0 }, { x: 0, y: -100 })[1].x).toBeGreaterThan(0);
  });
});

describe("keepToGutter", () => {
  const content = { left: 300, right: 900 };

  it("leaves a destination already in a margin alone", () => {
    expect(keepToGutter(40, content, 1200, 52)).toBe(40);
    expect(keepToGutter(1000, content, 1200, 52)).toBe(1000);
  });

  it("pushes a destination over the content into the nearer margin", () => {
    expect(keepToGutter(360, content, 1200, 52)).toBeLessThanOrEqual(content.left - 52);
    expect(keepToGutter(860, content, 1200, 52)).toBeGreaterThanOrEqual(content.right);
  });

  it("uses the other margin when the nearer one is too narrow to stand in", () => {
    const hugging = { left: 20, right: 900 };
    expect(keepToGutter(60, hugging, 1200, 52)).toBeGreaterThanOrEqual(hugging.right);
  });

  it("stays put when the screen has no margins at all", () => {
    const full = { left: 0, right: 500 };
    expect(keepToGutter(200, full, 500, 52)).toBe(200);
  });
});

describe("bowAway", () => {
  it("rounds the content instead of cutting across it, on either side", () => {
    expect(bowAway({ x: 20 }, { x: 60 }, 500)).toBeLessThan(0);
    expect(bowAway({ x: 900 }, { x: 960 }, 500)).toBeGreaterThan(0);
  });
});

describe("along", () => {
  const path = arc({ x: 0, y: 0 }, { x: 100, y: 0 });

  it("starts where it starts and ends where it ends", () => {
    expect(along(path, 0)).toEqual({ x: 0, y: 0 });
    expect(along(path, 1)).toEqual({ x: 100, y: 0 });
  });

  it("leaves the straight line in between, which is the whole point of the arc", () => {
    expect(along(path, .5).y).not.toBeCloseTo(0);
    expect(along(path, .5).x).toBeCloseTo(50);
  });

  it("never runs past either end, however the progress is given", () => {
    expect(along(path, -3)).toEqual({ x: 0, y: 0 });
    expect(along(path, 9)).toEqual({ x: 100, y: 0 });
  });

  it("moves in one direction the whole way", () => {
    const xs = Array.from({ length: 21 }, (_, i) => along(path, i / 20).x);
    expect(xs.every((x, i) => i === 0 || x >= xs[i - 1])).toBe(true);
  });
});
