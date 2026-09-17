import { isVariant, type Variant } from "./experiment";

/** One onboarding attempt, as the compare page reads it. Runs are recorded even
 * when the profile itself is not persisted, so a `/preview` pass still counts —
 * the preview is where both arms actually get driven side by side. */
export type RunCard = { id: string; kind: string; ms: number; revisits: number };
export type Run = {
  id: string;
  variant: Variant;
  /** True when the arm came from `?onboarding=`, not from the hash. Steering
   * yourself into an arm is not a sample, so rates exclude these. */
  forced: boolean;
  /** `fallback` means the inference arm ran the tree's questions because the
   * model was unavailable. Counting those as inference would compare an arm
   * against itself. */
  source: "tree" | "model" | "fallback";
  startedAt: string;
  endedAt: string | null;
  completed: boolean;
  cards: RunCard[];
  /** Where an incomplete run stopped. */
  abandonedAt: string | null;
  backs: number;
  thesis: string;
  themes: string[];
};

export const RUNS_KEY = "rubicon:onboarding:runs";
const LIMIT = 60;

export const newRun = (id: string, variant: Variant, forced: boolean, source: Run["source"]): Run =>
  ({ id, variant, forced, source, startedAt: new Date().toISOString(), endedAt: null, completed: false, cards: [], abandonedAt: null, backs: 0, thesis: "", themes: [] });

const num = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, max) : 0;
const str = (v: unknown, max: number) => typeof v === "string" ? v.slice(0, max) : "";

function readRun(raw: unknown): Run | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isVariant(r.variant) || typeof r.id !== "string") return null;
  const source = ["tree", "model", "fallback"].includes(r.source as string) ? r.source as Run["source"] : "tree";
  return {
    id: r.id, variant: r.variant, forced: r.forced === true, source,
    startedAt: str(r.startedAt, 40), endedAt: typeof r.endedAt === "string" ? r.endedAt.slice(0, 40) : null,
    completed: r.completed === true,
    cards: Array.isArray(r.cards) ? r.cards.slice(0, 24).map(c => ({ id: str((c as RunCard)?.id, 64), kind: str((c as RunCard)?.kind, 16), ms: num((c as RunCard)?.ms, 36e5), revisits: num((c as RunCard)?.revisits, 99) })) : [],
    abandonedAt: typeof r.abandonedAt === "string" ? r.abandonedAt.slice(0, 64) : null,
    backs: num(r.backs, 999), thesis: str(r.thesis, 2000),
    themes: Array.isArray(r.themes) ? r.themes.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
  };
}

export function loadRuns(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Run[] {
  try {
    const raw = JSON.parse(storage?.getItem(RUNS_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.map(readRun).filter((r): r is Run => !!r) : [];
  } catch { return []; }
}

/** Upsert by id: a run is written when it starts and rewritten as it advances,
 * so an abandoned run is still on record — that is the measurement. */
export function saveRun(run: Run, storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage) {
  try {
    const runs = loadRuns(storage).filter(r => r.id !== run.id);
    storage?.setItem(RUNS_KEY, JSON.stringify([run, ...runs].slice(0, LIMIT)));
  } catch { /* A browser without storage still gets the onboarding, just not the record. */ }
}

export type ArmSummary = { variant: Variant; runs: number; completed: number; completionRate: number; medianMs: number; medianCards: number; dropOff: Record<string, number> };

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/** What each arm looks like once the noise is excluded. A forced run is kept out
 * of the rates, and an inference run that fell back to the tree is not
 * inference. Both still appear individually, labelled, for reading the theses. */
export function summarize(runs: Run[], variant: Variant): ArmSummary {
  const counted = runs.filter(r => r.variant === variant && !r.forced && !(variant === "inference" && r.source === "fallback"));
  const completed = counted.filter(r => r.completed);
  const dropOff: Record<string, number> = {};
  for (const r of counted) if (!r.completed && r.abandonedAt) dropOff[r.abandonedAt] = (dropOff[r.abandonedAt] ?? 0) + 1;
  return {
    variant, runs: counted.length, completed: completed.length,
    completionRate: counted.length ? completed.length / counted.length : 0,
    medianMs: median(completed.map(r => r.cards.reduce((sum, c) => sum + c.ms, 0))),
    medianCards: median(completed.map(r => r.cards.length)),
    dropOff,
  };
}
