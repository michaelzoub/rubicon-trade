# Onboarding Sequenced by Jev — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed onboarding branching with a probabilistic profile model — Jev scores the accumulated evidence against every topic after each answer, and pure application code ranks, suppresses, bounds and picks the next React interaction.

**Architecture:** A new browser-safe model (`profile-model.ts`) holds raw evidence separately from inferred beliefs. A `server-only` layer (`profile-inference.ts`) asks Jev one `score` question per topic and returns beliefs. A pure sequencer (`profile-probe.ts`) owns every threshold and returns the next `Probe`. A stateless route glues them; a third onboarding arm renders probes through components that already exist.

**Tech Stack:** TypeScript, Next.js App Router (`app/api/trade/...`), React 19 client components, Vitest, OpenRouter decisions endpoint via the existing `askJev`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-09-18-jev-adaptive-onboarding-design.md`. Read it before starting.
- Run tests with `npm test`; a single file with `npx vitest run <path>`. Typecheck with `npm run typecheck`.
- `lib/socialtrading/profile-model.ts`, `profile-topics.ts` and `profile-probe.ts` are **browser-safe**: they must not import `jev.ts`, `server.ts`, or anything that imports `server-only`.
- `lib/socialtrading/profile-inference.ts` is **`server-only`** and must start with `import "server-only";`.
- Jev is never allowed to decide sequencing, run length, or which interaction renders. It returns `p` and `certainty` per topic and nothing else.
- Locally-computed values are never presented as the model's reading: a model with no Jev answer carries `source: "pending"`.
- Hard ceiling of **7** probes; floor of **3**.
- Thresholds, verbatim: `SUPPRESS = 0.15`, `KNOWN_CERTAINTY = 0.8`, `KNOWN_MARGIN = 0.3`, `MIN_VALUE = 0.05`, `TIE = 0.15`.
- Ranking, verbatim: `spread = 1 - |2p - 1|`; `uncertainty = 0.6 * spread + 0.4 * (1 - certainty)`; `value = p * uncertainty * importance`.
- The codebase writes dense, commented, single-purpose modules with typographic apostrophes (`’`) in user-facing copy. Match it.
- Commit after every task with the trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/socialtrading/topics.ts` (modify) | Discovery catalog. Gains five topic entries. |
| `lib/socialtrading/profile-topics.ts` (create) | Onboarding-only metadata per topic: claim, four knowledge-indexed claims, importance, geographic flag, category. |
| `lib/socialtrading/profile-model.ts` (create) | `Evidence`, `Belief`, `ProfileModel`; constructor, validator, evidence recorder. |
| `lib/socialtrading/profile-probe.ts` (create) | `rankTopics`, `getNextProfileProbe`, every threshold, interaction selection, fallback order. |
| `lib/socialtrading/profile-inference.ts` (create) | `server-only`. Builds Jev questions, reads beliefs back. |
| `app/api/trade/onboarding/probe/route.ts` (create) | Stateless POST: infer, merge, sequence, return. |
| `lib/socialtrading/onboarding-client.ts` (modify) | `fetchNextProbe`. |
| `lib/socialtrading/experiment.ts` (modify) | Third variant `adaptive`. |
| `lib/socialtrading/onboarding-metrics.ts` (modify) | `Run["source"]` gains `"jev"`. |
| `app/(hub)/onboarding-adaptive.tsx` (create) | The arm. Dispatches probe kinds into existing components. |
| `app/(hub)/onboarding-flow.tsx` (modify) | Routes the third arm. |

---

### Task 1: Extend the topic catalog

The sequencer scores topics at the granularity of "semiconductors", not "Technology". `TOPICS` already has ten at that granularity; onboarding covers five more that the catalog lacks. Existing consumers (`classifyTopic`, `topicSuggestions`) iterate the array and match on keywords, so they pick up new entries with no edits.

**Files:**
- Modify: `lib/socialtrading/topics.ts:6-19` (the `TOPICS` array)
- Test: `lib/socialtrading/topics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: five new ids usable as `typeof TOPICS[number]["id"]` — `"robotics"`, `"defence-sovereignty"`, `"climate-adaptation"`, `"stablecoins"`, `"future-of-work"`.

- [ ] **Step 1: Write the failing test**

Append to `lib/socialtrading/topics.test.ts`:

```ts
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
});
```

If `lib/socialtrading/topics.test.ts` does not exist, create it with this header first:

```ts
import { describe, expect, it } from "vitest";
import { TOPICS, classifyTopic } from "./topics";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/topics.test.ts`
Expected: FAIL — the `arrayContaining` assertion reports the five ids missing.

- [ ] **Step 3: Add the five entries**

Append inside the `TOPICS` array in `lib/socialtrading/topics.ts`, after `cloud-software` and before the closing `]`:

```ts
  { id: "robotics", name: "Robotics & automation", themes: ["tech"], keywords: /robot|automation|warehouse|factory|autonomous/i, assets: ["isrg", "nvda"] },
  { id: "defence-sovereignty", name: "Defence & sovereignty", themes: ["tech", "energy"], keywords: /defen[cs]e|sovereign|tariff|supply chain|reshor|onshor|military/i, assets: ["rtx"] },
  { id: "climate-adaptation", name: "Climate adaptation", themes: ["energy"], keywords: /climate|adaptation|flood|resilien|infrastructure|weather/i, assets: ["pwr"] },
  { id: "stablecoins", name: "Stablecoins & payments", themes: ["crypto"], keywords: /stablecoin|usdc|payment rail|settle|remittance/i, assets: ["usdc", "coin"] },
  { id: "future-of-work", name: "Work & labour", themes: ["consumer", "tech"], keywords: /\bwork\b|labour|labor|employ|job|workforce|productivity/i, assets: ["now"] },
```
- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/topics.test.ts && npm run typecheck`
Expected: PASS, and typecheck clean. The `satisfies` clause on `TOPICS` will flag a bad theme id at compile time.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/topics.ts lib/socialtrading/topics.test.ts
git commit -m "$(printf 'feat: extend the topic catalog for adaptive onboarding\n\nRobotics, defence, climate adaptation, stablecoins and work are domains\nonboarding asks about but discovery could not name. They are inherited by\ntopicSuggestions and asset discovery too, not just the sequencer.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 2: Onboarding metadata per topic

`topics.ts` stays a discovery catalog. Everything the sequencer needs — the proposition Jev scores, four statements indexed by knowledge level, a static importance prior, and whether a map reads better than a sentence — lives in its own file.

**Files:**
- Create: `lib/socialtrading/profile-topics.ts`
- Test: `lib/socialtrading/profile-topics.test.ts`

**Interfaces:**
- Consumes: `TOPICS` from Task 1; `CATEGORIES` from `onboarding.ts`.
- Produces:
  - `type TopicId = typeof TOPICS[number]["id"]`
  - `type ProbeTopic = { id: TopicId; category: string; claim: string; claims: readonly [string, string, string, string]; importance: number; geographic: boolean }`
  - `const PROBE_TOPICS: readonly ProbeTopic[]`
  - `probeTopic(id: string): ProbeTopic | undefined`
  - `topicName(id: TopicId): string`
  - `isTopicId(value: unknown): value is TopicId`

- [ ] **Step 1: Write the failing test**

Create `lib/socialtrading/profile-topics.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-topics.test.ts`
Expected: FAIL — `Cannot find module './profile-topics'`.

- [ ] **Step 3: Write the module**

Create `lib/socialtrading/profile-topics.ts`:

```ts
import { CATEGORIES } from "./onboarding";
import { TOPICS } from "./topics";

/**
 * What onboarding needs to know about a topic, kept out of `topics.ts` so the
 * discovery catalog does not become an onboarding file.
 *
 * `claim` is the proposition Jev scores the evidence against — it is never
 * shown to anyone. `claims` is what we put on screen, four statements at
 * rising depth indexed by knowledge level, exactly like `QUESTIONS` in
 * `onboarding.ts`. `importance` is a static prior for how much the topic
 * shapes a portfolio, so a topic cannot win a question on uncertainty alone.
 */
export type TopicId = (typeof TOPICS)[number]["id"];

export type ProbeTopic = {
  id: TopicId;
  /** One of CATEGORIES, so domain coverage stays legible in an adaptive profile. */
  category: string;
  claim: string;
  claims: readonly [string, string, string, string];
  /** 0–1. */
  importance: number;
  /** True where choosing places says more than agreeing with a sentence. */
  geographic: boolean;
};

const [TECHNOLOGY, ENERGY, MONEY, HEALTH, GOVERNMENT, CLIMATE, SOCIETY] = CATEGORIES;

export const PROBE_TOPICS: readonly ProbeTopic[] = [
  {
    id: "semiconductors", category: TECHNOLOGY, importance: 0.95, geographic: false,
    claim: "This person expects the chips that run AI to stay the scarcest, most valuable part of the stack.",
    claims: [
      "The companies making AI chips keep most of the profit.",
      "Chip supply, not software, decides how fast AI spreads.",
      "Chipmaking stays concentrated in a handful of firms for years.",
      "Custom silicon erodes the general-purpose chip margin before demand cools.",
    ],
  },
  {
    id: "data-centers", category: TECHNOLOGY, importance: 0.8, geographic: false,
    claim: "This person expects physical AI infrastructure — buildings, cooling, land — to be a durable constraint and a durable business.",
    claims: [
      "AI needs enormous new buildings, not just better software.",
      "Data centre capacity is booked out faster than it can be built.",
      "Where you can build a data centre matters more than who builds it.",
      "Today’s data centre build-out overshoots the demand it is sized for.",
    ],
  },
  {
    id: "cloud-software", category: TECHNOLOGY, importance: 0.55, geographic: false,
    claim: "This person expects software businesses to capture the gains from AI rather than be commoditised by it.",
    claims: [
      "Software companies come out of the AI shift stronger.",
      "Selling software by the seat stops working as AI does the work.",
      "Incumbent software keeps its customers because switching is too costly.",
      "AI compresses software margins faster than it expands software markets.",
    ],
  },
  {
    id: "robotics", category: TECHNOLOGY, importance: 0.75, geographic: false,
    claim: "This person expects machines to take over physical work at scale, and sees that as investable.",
    claims: [
      "Robots take more physical jobs than they create.",
      "Factories and warehouses run with far fewer people.",
      "Robotics creates more value in factories than in homes.",
      "Robotics changes the physical economy more than AI changes office work.",
    ],
  },
  {
    id: "power-grid", category: ENERGY, importance: 0.9, geographic: false,
    claim: "This person expects electricity supply to become the binding constraint on growth.",
    claims: [
      "Electricity becomes harder to get than oil.",
      "New power cannot keep up with AI and electric everything.",
      "Power availability holds AI back more than computing chips do.",
      "Electricity infrastructure outlasts the current AI boom.",
    ],
  },
  {
    id: "digital-money", category: MONEY, importance: 0.7, geographic: false,
    claim: "This person expects crypto assets to hold value as a store of value rather than fade as speculation.",
    claims: [
      "Crypto is here to stay, not a passing craze.",
      "Bitcoin behaves more like gold than like a tech stock.",
      "Crypto succeeds mainly through systems people barely notice.",
      "Digital finance keeps blockchain even if most cryptocurrencies disappear.",
    ],
  },
  {
    id: "stablecoins", category: MONEY, importance: 0.65, geographic: false,
    claim: "This person expects dollar-pegged tokens to become ordinary payment infrastructure.",
    claims: [
      "Crypto becomes everyday money, not just something people trade.",
      "Stablecoins become a normal way to pay, even for people who dislike crypto.",
      "Stablecoins matter more for moving money between countries than inside one.",
      "Regulated stablecoins displace card networks before banks adopt them.",
    ],
  },
  {
    id: "decentralized-finance", category: MONEY, importance: 0.45, geographic: false,
    claim: "This person expects financial services to be rebuilt on open protocols rather than inside institutions.",
    claims: [
      "Financial services get rebuilt on open networks.",
      "People will borrow and lend without a bank in the middle.",
      "Open finance wins in the places banks serve worst, not the places they serve well.",
      "Regulated institutions absorb open finance rather than being replaced by it.",
    ],
  },
  {
    id: "biotech", category: HEALTH, importance: 0.7, geographic: false,
    claim: "This person expects biological breakthroughs to translate into long, investable trends.",
    claims: [
      "Living healthy into your nineties becomes normal.",
      "New drugs change how common diseases are treated, not just how they are managed.",
      "Ageing populations reshape who works more than they reshape healthcare.",
      "Healthcare innovation accelerates, but rules stop it spreading fast.",
    ],
  },
  {
    id: "medical-technology", category: HEALTH, importance: 0.5, geographic: false,
    claim: "This person expects devices, robotics and software to reshape care delivery rather than drugs alone.",
    claims: [
      "Machines do more of the work in hospitals.",
      "Caring for ageing populations costs more than any other public service.",
      "Care moves out of hospitals and into homes and devices.",
      "Reimbursement, not capability, sets how fast medical technology spreads.",
    ],
  },
  {
    id: "defence-sovereignty", category: GOVERNMENT, importance: 0.8, geographic: true,
    claim: "This person expects countries to prioritise self-sufficiency and security over cheap global supply.",
    claims: [
      "Countries make more of their own goods, even if it costs more.",
      "Governments spend more on defence and making things at home than on cheap imports.",
      "Energy security matters more to governments than cheap energy.",
      "Bringing production home costs more and takes longer than governments expect.",
    ],
  },
  {
    id: "climate-adaptation", category: CLIMATE, importance: 0.7, geographic: true,
    claim: "This person expects spending to shift from preventing climate damage to living with it.",
    claims: [
      "We spend more fixing climate damage than preventing it.",
      "Protecting cities from climate damage becomes as big as cutting emissions.",
      "Climate adaptation grows faster than spending to prevent climate change.",
      "Climate adaptation attracts more money than preventing climate change.",
    ],
  },
  {
    id: "ai-applications", category: SOCIETY, importance: 0.95, geographic: false,
    claim: "This person expects AI to change how work is done across the economy, not only inside technology.",
    claims: [
      "AI takes over more work than it creates.",
      "People who do not use AI at work fall behind.",
      "AI changes old industries more than it creates new ones.",
      "The world is overestimating AI’s short-term impact and underestimating its long-term reach.",
    ],
  },
  {
    id: "future-of-work", category: SOCIETY, importance: 0.5, geographic: false,
    claim: "This person expects the shape of employment itself — who works, where, under what terms — to change materially.",
    claims: [
      "How people work changes more in ten years than in the last fifty.",
      "Fewer people do the same amount of work, for the same total pay.",
      "The gains from automation go to owners rather than workers.",
      "Labour shortages, not automation, drive the next decade of wage growth.",
    ],
  },
  {
    id: "consumer-trends", category: SOCIETY, importance: 0.35, geographic: false,
    claim: "This person expects changes in how people spend to be a driver worth investing behind.",
    claims: [
      "What people buy changes faster than what companies can make.",
      "Brands matter less than the platforms that sell them.",
      "Spending shifts from things to services and experiences.",
      "Consumer demand proves stickier than the headlines about it suggest.",
    ],
  },
];

const BY_ID = new Map(PROBE_TOPICS.map(topic => [topic.id as string, topic]));
const NAMES = new Map(TOPICS.map(topic => [topic.id as string, topic.name]));

export const probeTopic = (id: string): ProbeTopic | undefined => BY_ID.get(id);
export const topicName = (id: TopicId): string => NAMES.get(id) ?? id;
export const isTopicId = (value: unknown): value is TopicId => typeof value === "string" && BY_ID.has(value);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-topics.test.ts && npm run typecheck`
Expected: PASS. If "covers the catalog exactly once" fails, an id was misspelled against Task 1.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/profile-topics.ts lib/socialtrading/profile-topics.test.ts
git commit -m "$(printf 'feat: onboarding metadata for every catalog topic\n\nThe claim Jev scores, four statements indexed by knowledge level, a static\nimportance prior, and whether a map reads better than a sentence. Kept apart\nfrom topics.ts so the discovery catalog stays a discovery catalog.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 3: The profile model

Explicit answers and inferred probabilities are different things and must never be stored as one. `evidence` is append-only and is the only thing ever sent to Jev; `beliefs` is Jev's reading of it and is replaced wholesale each turn.

**Files:**
- Create: `lib/socialtrading/profile-model.ts`
- Test: `lib/socialtrading/profile-model.test.ts`

**Interfaces:**
- Consumes: `TopicId`, `isTopicId` from Task 2; `CardAnswer` from `onboarding-cards.ts`.
- Produces:
  - `type ProbeKind = "choice" | "spectrum" | "map" | "pad" | "chips" | "text"`
  - `type ProbeAnswer = CardAnswer | { kind: "map"; regions: string[] }`
  - `type Evidence = { id: string; at: string; kind: ProbeKind; prompt: string; topics: TopicId[]; answer: ProbeAnswer }`
  - `type Belief = { topic: TopicId; p: number; certainty: number }`
  - `type ProfileModel = { version: 1; evidence: Evidence[]; beliefs: Belief[]; asked: string[]; turn: number; source: "jev" | "pending" }`
  - `newProfileModel(): ProfileModel`
  - `readProfileModel(raw: unknown): ProfileModel | undefined`
  - `recordEvidence(model: ProfileModel, entry: Evidence): ProfileModel`
  - `const MAX_EVIDENCE = 32`

- [ ] **Step 1: Write the failing test**

Create `lib/socialtrading/profile-model.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-model.test.ts`
Expected: FAIL — `Cannot find module './profile-model'`.

- [ ] **Step 3: Write the module**

Create `lib/socialtrading/profile-model.ts`:

```ts
import type { CardAnswer } from "./onboarding-cards";
import { isTopicId, type TopicId } from "./profile-topics";

/**
 * The state adaptive onboarding carries between turns.
 *
 * Two things live here and they are deliberately not the same thing.
 * `evidence` is what the person actually did — appended once, never edited,
 * and the only thing ever sent to the model. `beliefs` is what Jev reads out
 * of that record, recomputed in full every turn rather than folded in
 * incrementally, so one bad reading cannot permanently bend the profile.
 *
 * `source` follows the rule `belief-tree.ts` sets: until the model has
 * answered, nothing here is the model's, and the view must say so.
 */
export type ProbeKind = "choice" | "spectrum" | "map" | "pad" | "chips" | "text";

/** The card kinds plus the one shape a map answer needs. */
export type ProbeAnswer = CardAnswer | { kind: "map"; regions: string[] };

export type Evidence = {
  /** The probe's id, which is also what keeps a topic from being asked twice. */
  id: string;
  at: string;
  kind: ProbeKind;
  /** What we asked, verbatim. Jev reads the question as well as the answer. */
  prompt: string;
  topics: TopicId[];
  answer: ProbeAnswer;
};

export type Belief = {
  topic: TopicId;
  /** 0–1. How far toward holding this claim the evidence puts them. */
  p: number;
  /** 0–1. Jev's confidence in that reading. */
  certainty: number;
};

export type ProfileModel = {
  version: 1;
  evidence: Evidence[];
  beliefs: Belief[];
  asked: string[];
  /** Probes answered, excluding the two foundation scenes. */
  turn: number;
  source: "jev" | "pending";
};

/** A long run should not grow an unbounded payload, and Jev's context is 32k. */
export const MAX_EVIDENCE = 32;
const MAX_PROMPT = 300;
const KINDS: ProbeKind[] = ["choice", "spectrum", "map", "pad", "chips", "text"];
const ANSWER_KINDS = ["scale", "binary", "pad", "chips", "text", "map"];

export const newProfileModel = (): ProfileModel =>
  ({ version: 1, evidence: [], beliefs: [], asked: [], turn: 0, source: "pending" });

/** Appends an answer. Beliefs are untouched: recording what someone did is not
 * the same act as deciding what it means. */
export function recordEvidence(model: ProfileModel, entry: Evidence): ProfileModel {
  return {
    ...model,
    evidence: [...model.evidence, entry].slice(-MAX_EVIDENCE),
    asked: model.asked.includes(entry.id) ? model.asked : [...model.asked, entry.id],
    turn: model.turn + 1,
  };
}

const unit = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null;

function readEvidence(raw: unknown): Evidence | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const kind = KINDS.find(k => k === e.kind);
  const answer = e.answer as { kind?: unknown } | null;
  if (!kind || typeof e.id !== "string" || typeof e.at !== "string" || typeof e.prompt !== "string") return null;
  if (!answer || typeof answer !== "object" || !ANSWER_KINDS.includes(answer.kind as string)) return null;
  const topics = Array.isArray(e.topics) ? e.topics.filter(isTopicId) : [];
  if (!topics.length || topics.length !== (e.topics as unknown[]).length) return null;
  return { id: e.id.slice(0, 64), at: e.at.slice(0, 40), kind, prompt: e.prompt.slice(0, MAX_PROMPT), topics, answer: answer as ProbeAnswer };
}

/** localStorage is untrusted input. A belief about a topic we retired, or a
 * probability that is not a number, is dropped rather than repaired. */
export function readProfileModel(raw: unknown): ProfileModel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) return undefined;
  const beliefs: Belief[] = (Array.isArray(m.beliefs) ? m.beliefs : []).flatMap((b: unknown) => {
    if (!b || typeof b !== "object") return [];
    const { topic, p, certainty } = b as Record<string, unknown>;
    const value = unit(p), sure = unit(certainty);
    return isTopicId(topic) && value !== null && sure !== null ? [{ topic, p: value, certainty: sure }] : [];
  });
  const evidence = (Array.isArray(m.evidence) ? m.evidence : []).map(readEvidence).filter((e): e is Evidence => !!e).slice(-MAX_EVIDENCE);
  const turn = typeof m.turn === "number" && Number.isFinite(m.turn) && m.turn >= 0 ? Math.min(99, Math.floor(m.turn)) : 0;
  return {
    version: 1, beliefs, evidence, turn,
    asked: Array.isArray(m.asked) ? [...new Set(m.asked.filter((id): id is string => typeof id === "string").map(id => id.slice(0, 64)))].slice(0, 64) : [],
    source: m.source === "jev" ? "jev" : "pending",
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-model.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/profile-model.ts lib/socialtrading/profile-model.test.ts
git commit -m "$(printf 'feat: the adaptive onboarding profile model\n\nEvidence is append-only and is the only thing sent to the model; beliefs are\nrecomputed in full every turn. Keeping them apart means one bad reading\ncannot permanently bend a profile, and localStorage stays untrusted input.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 4: Ranking and suppression

The half of the sequencer that decides *which topic*. Pure arithmetic over beliefs — no model access, no UI.

**Files:**
- Create: `lib/socialtrading/profile-probe.ts`
- Test: `lib/socialtrading/profile-probe.test.ts`

**Interfaces:**
- Consumes: `ProfileModel`, `Belief` from Task 3; `PROBE_TOPICS`, `probeTopic`, `ProbeTopic` from Task 2.
- Produces:
  - `const MAX_PROBES = 7`, `MIN_PROBES = 3`, `SUPPRESS = 0.15`, `KNOWN_CERTAINTY = 0.8`, `KNOWN_MARGIN = 0.3`, `MIN_VALUE = 0.05`, `TIE = 0.15`
  - The thresholds are asserted through behaviour, never as `expect(SUPPRESS).toBe(0.15)`. A test that restates a constant fails with no information about what broke. `MAX_PROBES` and `MIN_PROBES` stay imported, because Task 5's bound tests are written against them rather than against literal 7 and 3.
  - `type Candidate = { topic: ProbeTopic; p: number; certainty: number; value: number }`
  - `rankTopics(model: ProfileModel): Candidate[]`
  - `probeId(id: TopicId): string` — returns `` `probe:${id}` ``

- [ ] **Step 1: Write the failing test**

Create `lib/socialtrading/profile-probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_PROBES, MIN_PROBES, probeId, rankTopics } from "./profile-probe";
import { newProfileModel, type Belief, type ProfileModel } from "./profile-model";

const model = (beliefs: Belief[], patch: Partial<ProfileModel> = {}): ProfileModel =>
  ({ ...newProfileModel(), source: "jev", beliefs, ...patch });

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-probe.test.ts`
Expected: FAIL — `Cannot find module './profile-probe'`.

- [ ] **Step 3: Write the ranking half**

Create `lib/socialtrading/profile-probe.ts`:

```ts
import type { ProfileModel } from "./profile-model";
import { probeTopic, type ProbeTopic, type TopicId } from "./profile-topics";

/**
 * The sequencer. Every threshold in adaptive onboarding lives here, in pure
 * arithmetic over what Jev read — the model is never asked what to do next,
 * only what the evidence says. That split is the point: a probability is a
 * judgment, and choosing a question is a policy.
 */

/** Hard ceiling. A run is seven probes at most, however unsure we still are. */
export const MAX_PROBES = 7;
/** Floor. Below this a run always continues, so a decisive person still gets a
 * sequence with a shape rather than two questions and a summary. */
export const MIN_PROBES = 3;
/** Below this probability a topic is never asked about. */
export const SUPPRESS = 0.15;
/** A reading this sure, this far from the middle, is knowledge — not a question. */
export const KNOWN_CERTAINTY = 0.8, KNOWN_MARGIN = 0.3;
/** Past the floor, a best candidate worth less than this ends the run. */
export const MIN_VALUE = 0.05;
/** How close the top three must be before we let the person break the tie. */
export const TIE = 0.15;

export const probeId = (id: TopicId) => `probe:${id}`;

export type Candidate = { topic: ProbeTopic; p: number; certainty: number; value: number };

/**
 * Every topic still worth a question, best first.
 *
 * Relevance is the probability itself: a topic they probably care about earns
 * a question, one they probably do not does not. Uncertainty blends two
 * different ignorances — the reading sits near the middle, or the model is not
 * sure of its own reading. Importance is the static prior, so a topic that
 * barely moves a portfolio cannot win on uncertainty alone.
 */
export function rankTopics(model: ProfileModel): Candidate[] {
  const candidates: Candidate[] = [];
  for (const belief of model.beliefs) {
    const topic = probeTopic(belief.topic);
    if (!topic) continue;
    if (belief.p < SUPPRESS) continue;
    if (belief.certainty >= KNOWN_CERTAINTY && Math.abs(belief.p - 0.5) > KNOWN_MARGIN) continue;
    if (model.asked.includes(probeId(topic.id))) continue;
    const spread = 1 - Math.abs(2 * belief.p - 1);
    const uncertainty = 0.6 * spread + 0.4 * (1 - belief.certainty);
    candidates.push({ topic, p: belief.p, certainty: belief.certainty, value: belief.p * uncertainty * topic.importance });
  }
  // The id tiebreak keeps the order stable, so a run is reproducible in a test.
  return candidates.sort((a, b) => b.value - a.value || a.topic.id.localeCompare(b.topic.id));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-probe.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/profile-probe.ts lib/socialtrading/profile-probe.test.ts
git commit -m "$(printf 'feat: rank and suppress onboarding topics\n\nRelevance times uncertainty times importance, with a floor that drops a\ntopic the evidence says they do not care about and a ceiling that drops one\nwe already know. Pure arithmetic — the model never chooses the question.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 5: Stopping, interaction selection, and the fallback order

The half that decides *whether to ask, and with what*. Seven ordered rules, first match wins, every kind but `choice` spent at most once per run.

**Files:**
- Modify: `lib/socialtrading/profile-probe.ts` (append)
- Test: `lib/socialtrading/profile-probe.test.ts` (append)

**Interfaces:**
- Consumes: `rankTopics`, `Candidate` and the thresholds from Task 4; `OnboardingAnswers`, `CATEGORIES` from `onboarding.ts`; `topicName` from Task 2.
- Produces:
  - `type Probe = { id: string; kind: ProbeKind; title: string; lead: string; topics: TopicId[]; category: string; options?: string[] }`
  - `type ProbeContext = { knowledge: number; confidence: number; answers: OnboardingAnswers }`
  - `const SPECTRUM_STOPS: string[]` — four labels
  - `getNextProfileProbe(model: ProfileModel, ctx: ProbeContext): Probe | null`

- [ ] **Step 1: Write the failing test**

Append to `lib/socialtrading/profile-probe.test.ts`:

```ts
import { SPECTRUM_STOPS, getNextProfileProbe, type ProbeContext } from "./profile-probe";
import { newOnboarding } from "./onboarding";
import type { Evidence } from "./profile-model";

const ctx = (patch: Partial<ProbeContext> = {}): ProbeContext =>
  ({ knowledge: 1, confidence: 1, answers: newOnboarding(), ...patch });

const spent = (kind: Evidence["kind"], id: string): Evidence =>
  ({ id, at: "2026-09-18T10:00:00.000Z", kind, prompt: "asked", topics: ["robotics"], answer: { kind: "binary", direction: "yes" } });

/**
 * Four low-value beliefs. They exist only to get past rule 1 ("fewer than
 * three topics read"), so each test's own topic is the one that actually wins
 * the ranking. Their values are spread apart deliberately, so the chips rule
 * (top three within 15%) does not fire by accident.
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

  it("opens with a swipe deck while fewer than three topics have been read", () => {
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
    expect(getNextProfileProbe(model(strong, { turn: 2 }), ctx())).toMatchObject({ kind: "pad", topics: ["robotics"] });
  });

  it("does not ask for a horizon that onboarding already has", () => {
    const strong: Belief[] = [...settled, { topic: "robotics", p: 0.78, certainty: 0.7 }];
    const answers = { ...newOnboarding(), responses: [{ id: "r", category: "Technology", text: "t", direction: "yes" as const, years: 5 }] };
    expect(getNextProfileProbe(model(strong, { turn: 2 }), ctx({ answers }))!.kind).not.toBe("pad");
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
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 0 }))!.title).toBe("Robots take more physical jobs than they create.");
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 3 }))!.title).toBe("Robotics changes the physical economy more than AI changes office work.");
    expect(getNextProfileProbe(model(one), ctx({ knowledge: 9 }))!.title).toBe("Robotics changes the physical economy more than AI changes office work.");
  });

  it("walks the seven domains in order when the model never answered", () => {
    const pending = { ...newProfileModel(), turn: 0 };
    const first = getNextProfileProbe(pending, ctx());
    expect(first).toMatchObject({ kind: "choice", category: "Technology" });
    const second = getNextProfileProbe({ ...pending, turn: 1, evidence: [{ ...spent("choice", first!.id), topics: first!.topics }] }, ctx());
    expect(second!.category).toBe("Energy");
  });
});
```

Note: the test file already imports `Belief`, `ProfileModel`, `newProfileModel` and `model` from Task 4's block. Add `newProfileModel` to that import if it is not there.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-probe.test.ts`
Expected: FAIL — `getNextProfileProbe is not a function` / no export `SPECTRUM_STOPS`.

- [ ] **Step 3: Append the sequencing half**

Append to `lib/socialtrading/profile-probe.ts`, and extend its import line to
`import { PROBE_TOPICS, probeTopic, topicName, type ProbeTopic, type TopicId } from "./profile-topics";`
plus `import { CATEGORIES, type OnboardingAnswers } from "./onboarding";`
and `import type { ProbeKind, ProfileModel } from "./profile-model";`:

```ts
export type Probe = {
  id: string;
  kind: ProbeKind;
  title: string;
  lead: string;
  topics: TopicId[];
  category: string;
  /** `choice`, `spectrum` and `chips` carry labels; the others explain themselves. */
  options?: string[];
};

export type ProbeContext = { knowledge: number; confidence: number; answers: OnboardingAnswers };

/** Four stops, because a spectrum answer is stored as a `scale` index and
 * `applyAnswer` reads it as `options[value]`. A raw fraction would index nothing. */
export const SPECTRUM_STOPS = ["Strongly against", "Leaning against", "Leaning toward", "Strongly toward"];

const level = (knowledge: number) => Math.max(0, Math.min(3, Math.floor(knowledge)));
const usedKind = (model: ProfileModel, kind: ProbeKind) => model.evidence.some(e => e.kind === kind);

/**
 * Which interaction closes this particular gap. Ordered, first match wins.
 * Every kind but `choice` is spent at most once, so a run never repeats an
 * instrument — variety is a by-product of the gaps, not a goal of its own.
 */
function chooseKind(best: Candidate, ranked: Candidate[], model: ProfileModel, ctx: ProbeContext): ProbeKind {
  if (model.beliefs.length < 3) return "choice";
  if (best.topic.geographic && !usedKind(model, "map")) return "map";
  if (Math.abs(best.p - 0.5) > 0.25 && best.certainty < 0.6 && !usedKind(model, "spectrum")) return "spectrum";
  const hasHorizon = ctx.answers.responses.some(r => r.years !== undefined);
  if (best.p > 0.7 && best.certainty > 0.6 && !hasHorizon && !usedKind(model, "pad")) return "pad";
  if (ranked.length >= 3 && best.value - ranked[2].value <= TIE * best.value && !usedKind(model, "chips")) return "chips";
  if (ctx.knowledge >= 2 && model.turn >= 4 && !usedKind(model, "text")) return "text";
  return "choice";
}

function build(best: Candidate, ranked: Candidate[], model: ProfileModel, ctx: ProbeContext): Probe {
  const kind = chooseKind(best, ranked, model, ctx);
  const claim = best.topic.claims[level(ctx.knowledge)];
  const base = { id: probeId(best.topic.id), category: best.topic.category };
  if (kind === "chips") {
    const tied = ranked.slice(0, 3);
    return { ...base, kind, title: "Which of these actually matter to you?", lead: "Pick the ones you would want watched on your behalf.", topics: tied.map(c => c.topic.id), options: tied.map(c => topicName(c.topic.id)) };
  }
  if (kind === "spectrum") return { ...base, kind, title: claim, lead: "How strongly?", topics: [best.topic.id], options: SPECTRUM_STOPS };
  if (kind === "map") return { ...base, kind, title: claim, lead: "Choose where you think this plays out.", topics: [best.topic.id] };
  if (kind === "pad") return { ...base, kind, title: claim, lead: "How sure are you, and how soon?", topics: [best.topic.id] };
  if (kind === "text") return { ...base, kind, title: "What have we not asked about?", lead: "In your own words — one or two lines is plenty.", topics: [best.topic.id] };
  return { ...base, kind: "choice", title: claim, lead: "Take a side.", topics: [best.topic.id] };
}

/** Jev never answered, so there is nothing to rank. Walk the seven domains in
 * order — the fixed sequence is the floor under the adaptive one, not a
 * competing arm. */
function fallback(model: ProfileModel, ctx: ProbeContext): Probe | null {
  const covered = new Set(model.evidence.flatMap(e => e.topics.map(id => probeTopic(id)?.category)));
  const category = CATEGORIES.find(name => !covered.has(name));
  const topic = category ? PROBE_TOPICS.find(t => t.category === category) : undefined;
  if (!topic || !category) return null;
  return { id: probeId(topic.id), kind: "choice", title: topic.claims[level(ctx.knowledge)], lead: "Take a side.", topics: [topic.id], category };
}

/**
 * The next thing to ask, or `null` when the run is over.
 *
 * Sequencing, length and instrument are all decided here. Jev contributed the
 * two numbers on each belief and nothing else.
 */
export function getNextProfileProbe(model: ProfileModel, ctx: ProbeContext): Probe | null {
  if (model.turn >= MAX_PROBES) return null;
  if (!model.beliefs.length) return fallback(model, ctx);
  const ranked = rankTopics(model);
  if (!ranked.length) return null;
  const best = ranked[0];
  if (model.turn >= MIN_PROBES && best.value < MIN_VALUE) return null;
  return build(best, ranked, model, ctx);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-probe.test.ts && npm run typecheck`
Expected: PASS, all cases from both tasks.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/profile-probe.ts lib/socialtrading/profile-probe.test.ts
git commit -m "$(printf 'feat: choose the next probe and when to stop asking\n\nSeven ordered rules pick the interaction from the shape of the gap, every\nkind but choice spent once per run. Seven probes maximum, three minimum, and\na pending model walks the seven domains rather than stranding anyone.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 6: Reading the evidence with Jev

One `askJev` call per turn, one `score` question per topic, all in a single batch — the catalog is fifteen topics and `BATCH` is forty.

A `score`, not a `noul`: a noul returns a bare probability and carries no confidence, and certainty is precisely what the sequencer needs to know what *not* to ask.

**Files:**
- Create: `lib/socialtrading/profile-inference.ts`
- Test: `lib/socialtrading/profile-inference.test.ts`

**Interfaces:**
- Consumes: `askJev` from `jev.ts`; `PROBE_TOPICS` from Task 2; `Belief`, `Evidence` from Task 3.
- Produces:
  - `const BELIEF_LEVELS: string[]` — five ordered levels
  - `beliefQuestions(): Record<string, JevQuestion>`
  - `type Foundations = { confidence: number | null; knowledge: number | null }`
  - `inferBeliefs(evidence: Evidence[], foundations: Foundations, signal?: AbortSignal): Promise<Belief[] | null>`

- [ ] **Step 1: Write the failing test**

Create `lib/socialtrading/profile-inference.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BELIEF_LEVELS, beliefQuestions, inferBeliefs } from "./profile-inference";
import { PROBE_TOPICS } from "./profile-topics";
import type { Evidence } from "./profile-model";

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
    const beliefs = await inferBeliefs(evidence, { confidence: 1, knowledge: 1 });
    expect(beliefs).toEqual([{ topic: "robotics", p: 0.75, certainty: 0.6 }]);
  });

  it("returns null when Jev cannot be reached, so the caller keeps what it had", async () => {
    fetchMock.mockRejectedValue(new Error("upstream down"));
    expect(await inferBeliefs(evidence, { confidence: 1, knowledge: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-inference.test.ts`
Expected: FAIL — `Cannot find module './profile-inference'`.

- [ ] **Step 3: Write the module**

Create `lib/socialtrading/profile-inference.ts`:

```ts
import "server-only";
import { askJev } from "./jev";
import type { JevQuestion } from "./jev-types";
import { PROBE_TOPICS } from "./profile-topics";
import type { Belief, Evidence } from "./profile-model";

/**
 * What the evidence says, read by Jev.
 *
 * One question per topic, all in one batch — the catalog is fifteen and Jev's
 * batch is forty, so a turn is a single round trip. Each is a `score` rather
 * than a `noul`: a noul returns a bare probability and carries no confidence,
 * and confidence is exactly what the sequencer needs in order to know what not
 * to ask next.
 *
 * The state is the raw evidence and the two foundations. The previous beliefs
 * are deliberately not sent, so every turn is a fresh reading of the record
 * rather than a drift away from the last one.
 */

export const BELIEF_LEVELS = [
  "The evidence points away from this — they would reject it",
  "They lean against it",
  "Nothing in the evidence says either way",
  "They lean toward it",
  "The evidence points squarely at this — they hold it",
];

const INSTRUCTION = "Read only what this person actually answered. Where does the evidence put them on this claim?";

export function beliefQuestions(): Record<string, JevQuestion> {
  return Object.fromEntries(PROBE_TOPICS.map(topic => [
    topic.id,
    { type: "score", instructions: `${INSTRUCTION}\n\nClaim: ${topic.claim}`, criteria: BELIEF_LEVELS } satisfies JevQuestion,
  ]));
}

export type Foundations = { confidence: number | null; knowledge: number | null };

/** `null` means Jev could not be reached at all. The caller keeps the beliefs
 * it already had and marks the model `pending` — a reading nobody made is not
 * a reading of zero. */
export async function inferBeliefs(evidence: Evidence[], foundations: Foundations, signal?: AbortSignal): Promise<Belief[] | null> {
  const answers = await askJev({ foundations, evidence }, beliefQuestions(), signal);
  if (!answers) return null;
  const top = BELIEF_LEVELS.length - 1;
  const beliefs: Belief[] = [];
  for (const topic of PROBE_TOPICS) {
    const answer = answers[topic.id];
    if (!answer || answer.type !== "score") continue;
    beliefs.push({ topic: topic.id, p: answer.score / top, certainty: answer.confidence });
  }
  return beliefs;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-inference.test.ts && npm run typecheck`
Expected: PASS. `server-only` is aliased to an empty module by `vitest.config.ts`, so the import is inert under test.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/profile-inference.ts lib/socialtrading/profile-inference.test.ts
git commit -m "$(printf 'feat: read the onboarding evidence with Jev\n\nOne ordered score per topic in a single batch. A score rather than a noul,\nbecause a noul carries no confidence and confidence is what tells the\nsequencer which questions not to spend. Unreachable returns null.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 7: The probe endpoint and its client

Stateless: the whole model travels on every request, so the client never learns anything about inference.

**Files:**
- Create: `app/api/trade/onboarding/probe/route.ts`
- Create: `lib/socialtrading/profile-turn.ts`
- Create: `lib/socialtrading/profile-turn.test.ts`
- Modify: `lib/socialtrading/onboarding-client.ts` (append)

**Interfaces:**
- Consumes: `readProfileModel` (Task 3), `getNextProfileProbe` (Task 5), `inferBeliefs` (Task 6).
- Produces:
  - `advanceProfile(model, ctx, infer): Promise<{ model: ProfileModel; probe: Probe | null }>` in `profile-turn.ts`
  - `fetchNextProbe: ProbeFetcher` in `onboarding-client.ts`
  - `type ProbeFetcher = (input: ProbeRequest, signal?: AbortSignal) => Promise<ProbeResult>`

The merge logic lives in `profile-turn.ts` rather than the route so it can be tested without a `Request`; the route stays a thin HTTP shell, which is how the existing onboarding route is shaped.

- [ ] **Step 1: Write the failing test**

Create `lib/socialtrading/profile-turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { advanceProfile } from "./profile-turn";
import { newProfileModel, type Belief, type ProfileModel } from "./profile-model";
import { newOnboarding } from "./onboarding";

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
    const start = { ...newProfileModel(), evidence: [{ id: "probe:robotics", at: "2026-09-18T10:00:00.000Z", kind: "choice" as const, prompt: "p", topics: ["robotics" as const], answer: { kind: "binary" as const, direction: "yes" as const } }] };
    const { model } = await advanceProfile(start, ctx, async () => read);
    expect(model.evidence).toEqual(start.evidence);
  });

  it("reports the end of the run as a null probe rather than an error", async () => {
    const done: ProfileModel = { ...newProfileModel(), beliefs: read, source: "jev", turn: 7 };
    expect((await advanceProfile(done, ctx, async () => read)).probe).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/socialtrading/profile-turn.test.ts`
Expected: FAIL — `Cannot find module './profile-turn'`.

- [ ] **Step 3: Write `profile-turn.ts`**

Create `lib/socialtrading/profile-turn.ts`:

```ts
import { getNextProfileProbe, type Probe, type ProbeContext } from "./profile-probe";
import type { Belief, ProfileModel } from "./profile-model";

/** How a turn advances, kept out of the route so it can be tested without a
 * `Request`. The inference call is injected for the same reason. */
export type Infer = (model: ProfileModel) => Promise<Belief[] | null>;

/**
 * Read the evidence, then decide. A reading that never arrived leaves the
 * beliefs exactly as they were and marks the model `pending`: what we last
 * heard stays on record, but the view must not call it the model's word.
 */
export async function advanceProfile(model: ProfileModel, ctx: ProbeContext, infer: Infer): Promise<{ model: ProfileModel; probe: Probe | null }> {
  const beliefs = await infer(model);
  const next: ProfileModel = beliefs
    ? { ...model, beliefs, source: "jev" }
    : { ...model, source: "pending" };
  return { model: next, probe: getNextProfileProbe(next, ctx) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/socialtrading/profile-turn.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Write the route**

Create `app/api/trade/onboarding/probe/route.ts`:

```ts
import { authenticate, bodyOf, failure, HubError } from "@/lib/socialtrading/server";
import { readOnboarding, newOnboarding } from "@/lib/socialtrading/onboarding";
import { newProfileModel, readProfileModel } from "@/lib/socialtrading/profile-model";
import { inferBeliefs } from "@/lib/socialtrading/profile-inference";
import { advanceProfile } from "@/lib/socialtrading/profile-turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const bounded = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;

/** Local preview drives the arm without a session. Gated on a non-production
 * build AND an explicit header, exactly as the sibling onboarding route is, so
 * it cannot be reached on a deployed build even if the header is sent. */
function previewing(request: Request) {
  return process.env.NODE_ENV !== "production" && request.headers.get("x-onboarding-preview") === "1";
}

/**
 * One turn of adaptive onboarding. Stateless: the whole model arrives on the
 * request and the whole model goes back, so the client never has to know that
 * a model was consulted at all.
 */
export async function POST(request: Request) {
  try {
    if (!previewing(request)) await authenticate(request);
    const body = await bodyOf(request);
    if (!process.env.OPENROUTER_API_KEY) throw new HubError(503, "The onboarding model is not configured on this deployment.");

    const model = readProfileModel(body.model) ?? newProfileModel();
    const ctx = {
      knowledge: bounded(body.knowledge, 0, 4) ?? 0,
      confidence: bounded(body.confidence, 0, 3) ?? 0,
      answers: readOnboarding(body.answers) ?? newOnboarding(),
    };

    const { model: next, probe } = await advanceProfile(model, ctx, m =>
      inferBeliefs(m.evidence, { confidence: ctx.confidence, knowledge: ctx.knowledge }, request.signal));

    return Response.json(probe ? { model: next, probe } : { model: next, done: true });
  } catch (e) { return failure(e); }
}
```

- [ ] **Step 6: Add the client**

Append to `lib/socialtrading/onboarding-client.ts`, and extend its first import to also bring in the probe types:

```ts
import type { ProfileModel } from "@/lib/socialtrading/profile-model";
import type { Probe } from "@/lib/socialtrading/profile-probe";
import { readProfileModel } from "@/lib/socialtrading/profile-model";
import type { OnboardingAnswers } from "@/lib/socialtrading/onboarding";

export type ProbeRequest = { model: ProfileModel; knowledge: number | null; confidence: number | null; answers: OnboardingAnswers };
export type ProbeResult = { model: ProfileModel; probe: Probe | null };
export type ProbeFetcher = (input: ProbeRequest, signal?: AbortSignal) => Promise<ProbeResult>;

/** One turn. The model travels whole in both directions; the arm only ever
 * renders what comes back. */
export const fetchNextProbe: ProbeFetcher = async (input, signal) => {
  const response = await fetch("/api/trade/onboarding/probe", {
    method: "POST", signal, headers: await onboardingHeaders(),
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => ({})) as { model?: unknown; probe?: Probe; done?: boolean; error?: string };
  if (!response.ok) throw new Error(body.error ?? "The next question could not be chosen.");
  const model = readProfileModel(body.model);
  if (!model) throw new Error("The next question could not be chosen.");
  return { model, probe: body.done ? null : body.probe ?? null };
};
```

- [ ] **Step 7: Verify the whole suite and the build**

Run: `npm test && npm run typecheck`
Expected: PASS, with no regressions in the existing onboarding tests.

- [ ] **Step 8: Commit**

```bash
git add lib/socialtrading/profile-turn.ts lib/socialtrading/profile-turn.test.ts app/api/trade/onboarding/probe/route.ts lib/socialtrading/onboarding-client.ts
git commit -m "$(printf 'feat: the adaptive onboarding probe endpoint\n\nStateless — the whole model travels both ways, so the client never learns\nthat a model was consulted. The merge lives in profile-turn so it can be\ntested without a Request, and the route stays a thin HTTP shell.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 8: A third arm in the experiment

**Files:**
- Modify: `lib/socialtrading/experiment.ts:6` (`VARIANTS`)
- Modify: `lib/socialtrading/onboarding-metrics.ts:17` (`Run["source"]`) and `:41` (`readRun`)
- Test: `lib/socialtrading/experiment.test.ts`, `lib/socialtrading/onboarding-metrics.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `"adaptive"` as a `Variant`; `"jev"` as a `Run["source"]`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/socialtrading/experiment.test.ts`:

```ts
describe("the third arm", () => {
  it("offers adaptive alongside the two existing arms", () => {
    expect(VARIANTS).toEqual(["tree", "inference", "adaptive"]);
    expect(isVariant("adaptive")).toBe(true);
  });

  it("assigns every arm across a cohort, and assigns each id the same arm forever", () => {
    const ids = Array.from({ length: 300 }, (_, i) => `user-${i}`);
    const arms = new Set(ids.map(onboardingVariant));
    expect(arms).toEqual(new Set(VARIANTS));
    expect(ids.every(id => onboardingVariant(id) === onboardingVariant(id))).toBe(true);
  });

  it("lets the compare page force the adaptive arm", () => {
    expect(resolveAssignment("u", "?onboarding=adaptive")).toEqual({ variant: "adaptive", forced: true });
  });
});
```

Append to `lib/socialtrading/onboarding-metrics.test.ts`:

```ts
describe("the adaptive arm's source", () => {
  it("keeps a run that Jev actually read", () => {
    const run = { ...newRun("r1", "adaptive", false, "jev") };
    saveRun(run, storage());
    expect(loadRuns(storage()).at(0)?.source).toBe("jev");
  });

  it("still rejects a source it does not recognise", () => {
    const stored = [{ ...newRun("r2", "adaptive", false, "jev"), source: "vibes" }];
    expect(loadRuns({ getItem: () => JSON.stringify(stored) }).at(0)?.source).toBe("tree");
  });
});
```

If `onboarding-metrics.test.ts` has no `storage()` helper, use the one it already defines for writing runs; if it writes through a real `localStorage` stub, follow that existing pattern rather than introducing a new one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/socialtrading/experiment.test.ts lib/socialtrading/onboarding-metrics.test.ts`
Expected: FAIL — `VARIANTS` has two entries; `"jev"` is not assignable to `Run["source"]`.

- [ ] **Step 3: Make the changes**

In `lib/socialtrading/experiment.ts`, replace line 6:

```ts
export const VARIANTS = ["tree", "inference", "adaptive"] as const;
```

and extend the file's leading comment to name the third arm:

```ts
/** The onboarding A/B/C layer. Three arms ask for the same profile by
 * different means: `tree` walks the fixed decision tree, `inference` lets the
 * model write each next card, and `adaptive` scores the evidence with Jev and
 * chooses the next probe from what it still does not know. Assignment is a
 * pure function of the user id, so a reload, a second tab, and the compare
 * page all agree on which arm someone is in without storing anything. */
```

In `lib/socialtrading/onboarding-metrics.ts`, widen the source type and its validator:

```ts
  /** `fallback` means an arm ran the tree's questions because the model was
   * unavailable. Counting those as inference or as adaptive would compare an
   * arm against itself. `jev` is an adaptive run the decision model actually read. */
  source: "tree" | "model" | "jev" | "fallback";
```

```ts
  const source = ["tree", "model", "jev", "fallback"].includes(r.source as string) ? r.source as Run["source"] : "tree";
```

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS. Existing assignment tests that assert a specific arm for a specific id will now fail, because the hash is taken modulo three rather than two — update those expectations to the arm the function actually returns, since the id-to-arm mapping was never a contract, only its stability was.

- [ ] **Step 5: Commit**

```bash
git add lib/socialtrading/experiment.ts lib/socialtrading/experiment.test.ts lib/socialtrading/onboarding-metrics.ts lib/socialtrading/onboarding-metrics.test.ts
git commit -m "$(printf 'feat: a third onboarding arm\n\nadaptive joins tree and inference, and a run records jev when the decision\nmodel actually read it — separately from fallback, so an adaptive run that\nwalked the fixed order is never counted as adaptive.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

### Task 9: The adaptive arm

Renders probes through components that already exist. This task introduces no new interaction UI.

**Files:**
- Create: `app/(hub)/onboarding-adaptive.tsx`
- Create: `app/(hub)/onboarding-adaptive.test.tsx`
- Modify: `app/(hub)/onboarding-flow.tsx:9,27`

**Interfaces:**
- Consumes: `ArmProps`, `useProfileStore`, `useRunLog` from `onboarding-session.ts`; `fetchNextProbe`, `ProbeFetcher` from Task 7; `newProfileModel`, `recordEvidence` from Task 3; `MAX_PROBES` from Task 4; `applyAnswer` from `onboarding-cards.ts`; `FoundationScale`, `FamiliarityCheck`, `PredictionDeck`, `SmoothRange`, `GeographyMap`, `PredictionPad`, `OnboardingCard`, `DealingDeck`.
- Produces: `AdaptiveOnboarding` — same signature as `InferenceOnboarding`, with an injectable `fetchProbe` for tests.

- [ ] **Step 1: Write the failing test**

Create `app/(hub)/onboarding-adaptive.test.tsx`. Model it on the existing `onboarding-inference.test.tsx` — read that file first and copy its render helper, its `localStorage` stub and its Privy mocks verbatim rather than inventing new ones.

```tsx
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdaptiveOnboarding } from "./onboarding-adaptive";
import { newProfileModel, type ProfileModel } from "@/lib/socialtrading/profile-model";
import type { ProbeFetcher } from "@/lib/socialtrading/onboarding-client";

const probe = (model: ProfileModel) => ({
  model,
  probe: { id: "probe:robotics", kind: "choice" as const, title: "Robots take more physical jobs than they create.", lead: "Take a side.", topics: ["robotics" as const], category: "Technology" },
});

describe("the adaptive arm", () => {
  it("asks the probe the sequencer returned", async () => {
    const fetchProbe: ProbeFetcher = vi.fn(async () => probe(newProfileModel()));
    renderArm({ fetchProbe });
    await answerFoundations();
    await waitFor(() => expect(screen.getByText("Robots take more physical jobs than they create.")).toBeTruthy());
  });

  it("sends the answer back as evidence, not as a belief", async () => {
    const fetchProbe = vi.fn(async () => probe(newProfileModel())) as unknown as ProbeFetcher;
    renderArm({ fetchProbe });
    await answerFoundations();
    await waitFor(() => screen.getByText("Robots take more physical jobs than they create."));
    await userEvent.click(screen.getByRole("button", { name: /yes|agree/i }));
    await waitFor(() => {
      const last = (fetchProbe as unknown as { mock: { calls: [{ model: ProfileModel }][] } }).mock.calls.at(-1)![0];
      expect(last.model.evidence.at(-1)).toMatchObject({ id: "probe:robotics", kind: "choice", topics: ["robotics"], answer: { kind: "binary", direction: "yes" } });
      expect(last.model.beliefs).toEqual([]);
    });
  });

  it("falls back to the knowledge bank and records it when the endpoint fails", async () => {
    const fetchProbe: ProbeFetcher = vi.fn(async () => { throw new Error("down"); });
    renderArm({ fetchProbe });
    await answerFoundations();
    await waitFor(() => expect(screen.getByRole("article")).toBeTruthy());
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it("reaches the rules scene when the run is done", async () => {
    const fetchProbe: ProbeFetcher = vi.fn(async () => ({ model: newProfileModel(), probe: null }));
    renderArm({ fetchProbe });
    await answerFoundations();
    await waitFor(() => expect(screen.getByText("How should your agent act?")).toBeTruthy());
  });
});
```

Write `renderArm` and `answerFoundations` as local helpers in this file, mirroring how `onboarding-inference.test.tsx` drives its two foundation scenes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(hub)/onboarding-adaptive.test.tsx"`
Expected: FAIL — `Cannot find module './onboarding-adaptive'`.

- [ ] **Step 3: Write the arm**

Create `app/(hub)/onboarding-adaptive.tsx` by copying `app/(hub)/onboarding-inference.tsx` in full and renaming the component to `AdaptiveOnboarding`. That file already holds the profile store, the run log, the two foundation scenes, the rules scene, `update()` and `finish()` in exactly the shape this arm needs. Keep all of that byte-for-byte and replace only what is listed below.

**Delete** from the copy: the `cards` / `loading` / `requested` state, the `request` callback, the `atRules` derivation, the old `TOTAL` constant, the `fetchDeck` prop, and `CardInput`'s `binary` and `pad` branches. Keep `CardInput`'s `chips` and `text` branches — the adaptive arm renders both.

**Replace the imports** with the inference arm's list minus `fetchPredictionDeck`, `DeckFetcher`, `predictions` and `PREDICTION_COUNT`, plus:

```tsx
import { getNextProfileProbe, MAX_PROBES, type Probe } from "@/lib/socialtrading/profile-probe";
import { newProfileModel, recordEvidence, type Evidence, type ProbeAnswer, type ProfileModel } from "@/lib/socialtrading/profile-model";
import { applyAnswer, type CardKind } from "@/lib/socialtrading/onboarding-cards";
import { fetchNextProbe, type ProbeFetcher } from "./onboarding-client";
import { GeographyMap } from "./onboarding-geo";
import { SmoothRange, intervalAt } from "./onboarding-drag";
import { PredictionPad } from "./onboarding-chart";
import { PredictionDeck, DealingDeck } from "./onboarding-deck";
```

**Add** at module scope:

```tsx
/** Two foundations, up to seven probes, then the rules. Seven is a ceiling:
 * a run that runs out of worthwhile questions stops short of it. */
const TOTAL = 2 + MAX_PROBES + 1;

/** A probe kind names an interaction; a card kind names an answer shape.
 * `applyAnswer` speaks the second, so the two are mapped rather than merged.
 *
 * `map` is deliberately absent from the parameter type. A map answer goes
 * straight into `ownBelief` and never reaches `applyAnswer`, so the compiler
 * proves that branch cannot exist rather than us carrying a line that never
 * runs. The one call site narrows with `answer.kind === "map"` first. */
const cardKind = (kind: Exclude<Probe["kind"], "map">): CardKind =>
  kind === "spectrum" ? "scale" : kind === "choice" ? "binary" : kind;
```

**Change the signature** to:

```tsx
export function AdaptiveOnboarding({ userId, onComplete, completing = false, serverError = "", persist = true, agentCreation = false, plan = DEFAULT_PLAN, variant, forced, fetchProbe = fetchNextProbe }: ArmProps & { fetchProbe?: ProbeFetcher }) {
```

**Replace the deck state** with:

```tsx
  const [model, setModel] = useState<ProfileModel>(newProfileModel);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0.5);
  const [regions, setRegions] = useState<string[]>([]);
  const [pad, setPad] = useState({ confidence: 75, years: 5 });
```

**Add the turn**, in place of the deleted `request` callback:

```tsx
  /** One turn. A failed request falls back to the local sequencer over the
   * model we already hold, so an unreachable endpoint walks the seven domains
   * rather than stranding anyone mid-run. */
  const advance = useCallback(async (current: ProfileModel) => {
    setLoading(true);
    try {
      const result = await fetchProbe({ model: current, knowledge, confidence: a.confidence, answers: a });
      log.setSource(result.model.source === "jev" ? "jev" : "fallback");
      setModel(result.model);
      setProbe(result.probe);
      setDone(!result.probe);
    } catch {
      log.setSource("fallback");
      const local = getNextProfileProbe(current, { knowledge: knowledge ?? 0, confidence: a.confidence ?? 0, answers: a });
      setProbe(local);
      setDone(!local);
    } finally { setLoading(false); }
  }, [fetchProbe, knowledge, a, log]);

  /** An answer is two separate writes: the evidence entry, and the same answer
   * folded into `OnboardingAnswers` so the thesis reads identically to the
   * other two arms. Neither one touches `beliefs` — deciding what an answer
   * means is the model's job, on the next turn. */
  function answerProbe(p: Probe, answer: ProbeAnswer) {
    const entry: Evidence = { id: p.id, at: new Date().toISOString(), kind: p.kind, prompt: p.title, topics: p.topics, answer };
    const next = recordEvidence(model, entry);
    setModel(next);
    setProbe(null);
    setPosition(0.5); setRegions([]); setPad({ confidence: 75, years: 5 });
    if (answer.kind === "map") update({ ownBelief: `${a.ownBelief} ${p.title} ${answer.regions.join(", ")}.`.trim().slice(0, 300) });
    else update(applyAnswer(a, { id: p.id, kind: cardKind(p.kind), title: p.title, lead: p.lead, category: p.category, ...(p.options ? { options: p.options } : {}) }, answer));
    void advance(next);
  }
```

**Replace the `useEffect` that fetched the deck** with one that opens the first turn once the foundations are behind us:

```tsx
  useEffect(() => {
    if (!loaded || index < 0 || probe || done || loading) return;
    void advance(model);
  }, [loaded, index, probe, done, loading, model, advance]);
```

**Replace the `position` derivation** — rename it `logged`, so it does not collide with the spectrum's `position` state — so a turn in flight logs nothing:

```tsx
  const logged = done ? { id: "rules", kind: "rules" }
    : index === SEEDS.clarity ? { id: "clarity", kind: "scale" }
    : index === SEEDS.knowledge ? { id: "knowledge", kind: "chips" }
    : probe ? { id: probe.id, kind: probe.kind } : null;
  useEffect(() => { if (loaded && logged) log.enter(logged.id, logged.kind); }, [loaded, logged?.id, logged?.kind, log]);
```

**Replace `next()`** so it no longer walks an index past the foundations — after the second foundation, `advance` drives the run:

```tsx
  function next() {
    if (index === SEEDS.clarity && a.confidence === null) return setError("Choose how clear the future feels to you.");
    if (index === SEEDS.knowledge) { completeKnowledge(scoreFamiliarity(profile.investorAnswers.selectedConceptIds ?? [])); return; }
    setIndex(0);
  }
```

`back()` stays as it is; from the first probe it lands on the knowledge scene, which is where it should.

**Progress** is `Math.min(TOTAL, model.turn + 3)` over `TOTAL`, and every `atRules` in the copied JSX becomes `done`.

**Render** by dispatching on `probe.kind`, in place of the inference arm's single `<CardInput>`:

| Kind | Render | Answer produced |
| --- | --- | --- |
| `choice` | `<PredictionDeck card={{ id: probe.id, category: probe.category, text: probe.title }} answered={model.turn} total={MAX_PROBES} onVote={d => answerProbe(probe, { kind: "binary", direction: d })} />` | `{ kind: "binary", direction }` |
| `spectrum` | `<SmoothRange value={position} label={probe.title} valueText={probe.options![intervalAt(position)]} onChange={setPosition} />`, with Continue calling `answerProbe(probe, { kind: "scale", value: intervalAt(position) })` | `{ kind: "scale", value }` — the interval, never the raw fraction |
| `map` | `<GeographyMap selected={regions} thesis="" onSelected={setRegions} onThesis={() => {}} />`, with Continue calling `answerProbe(probe, { kind: "map", regions })` | `{ kind: "map", regions }` |
| `pad` | `<PredictionPad response={{ id: probe.id, category: probe.category, text: probe.title, direction: "yes", ...pad }} onChange={r => setPad({ confidence: r.confidence ?? 75, years: r.years ?? 5 })} />`, with Continue calling `answerProbe(probe, { kind: "pad", ...pad })` | `{ kind: "pad", confidence, years }` |
| `chips` | The `chips` branch of `CardInput`, kept from the copy | `{ kind: "chips", values }` |
| `text` | The `text` branch of `CardInput`, kept from the copy | `{ kind: "text", value }` |

`choice` commits itself on the swipe, so it passes `onNext={undefined}` to `OnboardingCard`. Every other kind keeps the Continue button, wired to the call in its row above.

While `loading` and no probe is in hand, render `<DealingDeck backs={2} answered={model.turn} total={MAX_PROBES} />`, exactly as the inference arm does — logging a card id during that gap would invent cards that never showed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run "app/(hub)/onboarding-adaptive.test.tsx" && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Route the arm**

In `app/(hub)/onboarding-flow.tsx`, add the import and widen the selection:

```tsx
import { AdaptiveOnboarding } from "./onboarding-adaptive";
```

```tsx
  const ARMS = { tree: TreeOnboarding, inference: InferenceOnboarding, adaptive: AdaptiveOnboarding };
  const Arm = ARMS[assignment.variant];
```

Replace the existing ternary on line 27 with these two lines. A record rather than a chain, so a fourth arm is one entry and the exhaustiveness is checked by the compiler.

- [ ] **Step 6: Verify everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS. A `build` failure in the new route usually means a browser-safe module reached for `server-only` — check that `onboarding-adaptive.tsx` imports `profile-probe.ts` and never `profile-inference.ts`.

- [ ] **Step 7: Commit**

```bash
git add "app/(hub)/onboarding-adaptive.tsx" "app/(hub)/onboarding-adaptive.test.tsx" "app/(hub)/onboarding-flow.tsx"
git commit -m "$(printf 'feat: the adaptive onboarding arm\n\nThe two foundations seed the model, then each answer is recorded as evidence\nand the endpoint returns the next probe. Rendering is a dispatch into the\ncomponents onboarding already has; this arm adds no new interaction UI.\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>')"
```

---

## Verification

After Task 9, the following should all hold. Run them before calling the feature done.

```bash
npm test && npm run typecheck && npm run build
```

Then drive it by hand:

```bash
npm run dev
```

Open `http://localhost:3000/preview?onboarding=adaptive` and confirm: the two foundation scenes appear, the first probe is a swipe deck, the interaction changes across the run rather than repeating, and the run ends at seven probes or earlier.

With `OPENROUTER_API_KEY` unset the route returns 503 and the arm falls back to the seven-domain order — confirm that path too, since it is the one a user hits when Jev is down.
