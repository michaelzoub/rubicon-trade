# Onboarding sequenced by Jev

Onboarding stops walking a fixed order and starts asking whatever it still
does not know. After every interaction the accumulated evidence goes to Jev,
which reads it and returns a position and a calibrated confidence for each
topic in the catalog. Application code then decides what to ask next: it
suppresses topics the person clearly does not care about, skips the ones it
already knows with confidence, ranks the rest, and picks a React interaction
suited to the particular gap it is closing.

The split is deliberate and load-bearing. **Jev owns probabilistic judgment
and nothing else.** Sequencing, thresholds, run length, persistence and UI
selection live in ordinary, pure, testable code. There is no decision tree to
maintain, and no prompt that quietly decides how long onboarding is.

## Decisions

- **A third arm.** `VARIANTS` gains `"adaptive"` beside `tree` and
  `inference`. The existing two arms are untouched, so the run log in
  `onboarding-metrics.ts` compares three arms rather than replacing a
  baseline mid-experiment.
- **Explicit answers and inferred probabilities never mix.** `evidence` is an
  append-only record of what the person actually did. `beliefs` is Jev's
  reading of that record, recomputed in full every turn. A bad turn cannot
  permanently poison the profile, because nothing is ever folded in
  incrementally.
- **Local arithmetic is never dressed up as the model's.** `ProfileModel.source`
  is `"pending"` until Jev has answered, following the rule already set by
  `belief-tree.ts`.
- **Seven probes maximum.** A floor of three keeps a run from being trivially
  short; the ceiling is hard.
- **Probe text is a static bank, not a second model call.** Claims are indexed
  by knowledge level, exactly like `QUESTIONS` in `onboarding.ts`. Probes stay
  deterministic, testable, and free.
- **Onboarding is client-owned.** It runs before the workspace exists and
  `/preview` has no session, so the model lives in `investorAnswers` and is
  mirrored to localStorage by the existing `useProfileStore`. The route is
  stateless.

## The model — `lib/socialtrading/profile-model.ts`

Browser-safe. No imports from `server-only` modules, because both the route
and the arm read these types.

```ts
export type ProbeKind = "choice" | "spectrum" | "map" | "pad" | "chips" | "text";

/** One thing the person actually did. Written once, never edited. */
export type Evidence = {
  id: string;          // the probe's id
  at: string;          // ISO timestamp
  kind: ProbeKind;
  prompt: string;      // what we asked, verbatim
  topics: TopicId[];   // the topics the probe touched
  answer: ProbeAnswer; // the literal answer
};

/** What we infer. Replaced wholesale each turn; never edited in place. Every
 *  belief is Jev's — there is no locally-computed variant of this shape. */
export type Belief = {
  topic: TopicId;
  p: number;         // 0–1. How far toward holding this claim the evidence puts them.
  certainty: number; // 0–1. Jev's confidence in that reading.
};

export type ProfileModel = {
  version: 1;
  evidence: Evidence[];
  beliefs: Belief[];
  asked: string[];   // probe ids already spent
  turn: number;      // probes answered, excluding the two foundations
  source: "jev" | "pending";
};
```

`ProbeAnswer` extends the existing `CardAnswer` union in
`onboarding-cards.ts` with the one shape it lacks:

```ts
export type ProbeAnswer = CardAnswer | { kind: "map"; regions: string[] };
```

`readProfileModel(raw)` validates an untrusted model out of localStorage the
way `readOnboarding` does: wrong version returns `undefined`, unknown topic
ids are dropped, `p` and `certainty` are clamped to 0–1, `evidence` is capped
at 32 entries and each `prompt` at 300 characters.

`newProfileModel()` returns an empty model with `source: "pending"`.

## The topic space — `topics.ts` and `profile-topics.ts`

`TOPICS` already has the granularity the brief asks for — semiconductors,
power-grid, cloud-software, data-centers, biotech — and already maps each
topic to themes and discovery assets. It gains the five entries onboarding
covers today that the catalog lacks:

| id | name | themes |
| --- | --- | --- |
| `robotics` | Robotics & automation | tech |
| `defence-sovereignty` | Defence & sovereignty | tech, energy |
| `climate-adaptation` | Climate adaptation | energy |
| `stablecoins` | Stablecoins & payments | crypto |
| `future-of-work` | Work & labour | consumer, tech |

Existing consumers of `TOPICS` — `classifyTopic`, `topicSuggestions` — keep
working unchanged; they iterate the array and match on keywords, so new
entries are picked up without edits.

`lib/socialtrading/profile-topics.ts` adds the onboarding-only metadata, keyed
by topic id, so `topics.ts` stays a discovery catalog rather than becoming an
onboarding file:

```ts
type ProbeTopic = {
  id: TopicId;
  category: string;    // one of CATEGORIES, so domain coverage is still legible
  claim: string;       // the proposition Jev scores the evidence against
  claims: string[];    // four statements, indexed by knowledge level 0–3
  importance: number;  // 0–1 static prior: how much this topic shapes a portfolio
  geographic: boolean; // true where a map is a better instrument than a statement
};
```

Every topic names a `category`, so the seven-domain coverage story the tree
arm guarantees remains readable from an adaptive profile — as a report, not
as a constraint on what gets asked.

## Inference — `lib/socialtrading/profile-inference.ts`

`server-only`. One `askJev` call per turn, one question per topic, all in a
single batch (the catalog is fifteen topics; `BATCH` is forty).

Each question is a `score`, not a `noul`. A noul returns a bare probability
and carries no confidence, and certainty is precisely what the sequencer needs
in order to know what *not* to ask.

```ts
const LEVELS = [
  "The evidence points away from this — they would reject it",
  "They lean against it",
  "Nothing here says either way",
  "They lean toward it",
  "The evidence points squarely at this — they hold it",
];
```

`p = score / 4`, `certainty = answer.confidence`. The `state` handed to Jev is
the raw evidence log plus the two foundations (clarity, knowledge) — never the
previous beliefs, so each turn is a fresh reading of the record rather than a
drift from the last one.

`inferBeliefs(evidence, foundations)` returns `Belief[]`, or `null` when
`askJev` returns `null`. A `null` leaves the caller's existing beliefs in
place and flips `source` to `"pending"`.

## Sequencing — `lib/socialtrading/profile-probe.ts`

Pure, browser-safe, no model access. This is the layer the brief calls
`getNextProfileProbe`. It takes the answers alongside the model because two of
the interaction rules read what onboarding has already captured — a horizon on
`OnboardingAnswers.responses[].years`, and the knowledge level that indexes the
claim bank.

```ts
export type Probe = {
  id: string;
  kind: ProbeKind;
  title: string;
  lead: string;
  topics: TopicId[];
  category: string;
  options?: string[];   // choice and chips
};

export function getNextProfileProbe(
  model: ProfileModel,
  ctx: { knowledge: number; confidence: number; answers: OnboardingAnswers },
): Probe | null;
```

### Filters

- **Suppress.** A topic with `p < 0.15` is dropped. Someone whose evidence
  puts SaaS at 0.01 is never asked about SaaS.
- **Skip the known.** A topic with `certainty >= 0.8` and `|p - 0.5| > 0.3` is
  dropped. We know the answer; asking again spends a question to learn nothing.
- **Skip the spent.** A topic whose probe id is already in `asked` is dropped.

### Ranking

For each surviving topic:

```
spread      = 1 - |2p - 1|                  // peaks at p = 0.5
doubt       = 1 - certainty
uncertainty = 0.6 * spread + 0.4 * doubt
value       = p * uncertainty * importance
```

Relevance is `p` itself: a topic they probably care about is worth a question,
a topic they probably do not is not. `uncertainty` blends two different
ignorances — the reading sits near the middle, or the model is not sure of the
reading. `importance` is the static prior, so a topic that barely moves a
portfolio does not win on uncertainty alone.

### Stopping

- `turn >= 7` → `null`. Hard ceiling.
- `turn >= 3` and the best `value < 0.05` → `null`. Nothing left worth asking.
- `turn < 3` → always returns a probe, taking the best value even below the
  threshold, so a decisive person still gets a run with a shape to it.
- No surviving candidates → `null` regardless of turn.

Progress reads `turn / 7`, which is honest: it is a ceiling, and the run may
end early.

### Choosing the interaction

Deterministic, derived from the shape of the gap rather than from variety for
its own sake. The first matching rule wins. Every kind except `choice` is used
at most once per run.

| # | When | Kind | Component |
| --- | --- | --- | --- |
| 1 | fewer than three topics have any belief | `choice` | `PredictionDeck` — swipe the top claims |
| 2 | winning topic is `geographic` | `map` | `GeographyMap` |
| 3 | `\|p - 0.5\| > 0.25` but `certainty < 0.6` | `spectrum` | `SmoothRange` — direction is read, strength is not |
| 4 | `p > 0.7`, `certainty > 0.6`, and no response in `answers.responses` carries `years` | `pad` | `PredictionPad` — confidence × horizon |
| 5 | top three candidates within 15% of each other | `chips` | card chips — let them break the tie |
| 6 | `knowledge >= 2` and `turn >= 4` | `text` | card textarea — they can say it better than we can ask |
| 7 | otherwise | `choice` | `PredictionDeck` |

Probe copy comes from `claims[knowledge]` on the winning topic. `chips`
options are the names of the tied topics; `choice` options are the claims of
the top candidates.

A `spectrum` probe carries exactly four `options`, and its answer is the
interval `intervalAt(position)` returns rather than the raw 0–1 position. That
keeps it inside the existing `CardAnswer` `scale` shape, which `applyAnswer`
reads as `card.options[answer.value]` — a raw fraction would index nothing.

### Fallback

`getNextProfileProbe` on a model with `source: "pending"` and no beliefs walks
`CATEGORIES` in order, returning a `choice` probe per uncovered category. An
unreachable Jev degrades to the fixed order rather than stranding anyone, and
the run log records `source: "fallback"` so the run is never counted as
adaptive.

## The route — `app/api/trade/onboarding/probe/route.ts`

`POST { model, knowledge, confidence }` → `{ model, probe }` or
`{ model, done: true }`.

Stateless. It validates the incoming model with `readProfileModel`, calls
`inferBeliefs`, merges the result (or keeps the old beliefs and sets
`"pending"` on `null`), calls `getNextProfileProbe`, and returns both the
updated model and the probe. Returning the model is what keeps the client from
having to know anything about inference.

It reuses the `previewing(request)` gate from the existing onboarding route —
non-production build **and** an explicit `x-onboarding-preview` header — so
`/preview` drives the arm without a session and a deployed build cannot.

`lib/socialtrading/onboarding-client.ts` gains `fetchNextProbe`, following
`fetchNextCard`'s shape: bearer token when signed in, preview header otherwise.

## The arm — `app/(hub)/onboarding-adaptive.tsx`

Takes `ArmProps` unchanged, so the router swaps it in like the other two. The
two foundation scenes (clarity, knowledge) are unchanged and are not probes —
they seed the model. After them the arm loops: render the current probe,
capture the answer as `Evidence`, POST the model, render what comes back, stop
on `done`, then the rules scene and `finish()` exactly as the inference arm
does today.

Rendering is a dispatch on `probe.kind` into components that already exist;
this arm introduces no new interaction UI. Each kind's answer is recorded as
evidence in its own shape:

| Kind | Component | Evidence answer |
| --- | --- | --- |
| `choice` | `PredictionDeck` | `{ kind: "binary", direction }` |
| `spectrum` | `SmoothRange` | `{ kind: "scale", value }` — the 0–3 interval |
| `map` | `GeographyMap` | `{ kind: "map", regions }` |
| `pad` | `PredictionPad` | `{ kind: "pad", confidence, years }` |
| `chips` | card chips | `{ kind: "chips", values }` |
| `text` | card textarea | `{ kind: "text", value }` |

`applyAnswer` in `onboarding-cards.ts` continues to fold each answer into
`OnboardingAnswers`, so the adaptive arm reaches `onboardingThesis` and
`suggestedThemes` with the same shape as the other two and the three arms stay
comparable. A `map` answer folds into `ownBelief` as the named regions.

## Metrics — `lib/socialtrading/onboarding-metrics.ts`

`Run["source"]` gains `"jev"`. The arm sets `"jev"` on a turn Jev answered and
`"fallback"` on a turn it did not, using the existing `log.setSource`. The
compare page groups by three variants rather than two.

## Tests

- **Suppression.** A topic at `p = 0.10` is never returned, at any turn.
- **Known-skip.** A topic at `certainty = 0.9`, `p = 0.9` is never returned;
  the same `p` at `certainty = 0.5` still can be.
- **Ranking.** Given three hand-built belief sets, the expected topic wins, and
  `importance` breaks a tie between two equally uncertain topics.
- **Bounds.** A run returns `null` at turn 7. A run at turn 2 with every value
  under the threshold still returns a probe; at turn 3 it returns `null`.
- **Kind selection.** One case per row of the interaction table, asserting the
  first matching rule wins and that a kind already spent is not reissued.
- **Evidence is separate.** Recomputing beliefs from a different Jev reply
  leaves `evidence` byte-identical.
- **Jev null.** `inferBeliefs` returning `null` keeps the previous beliefs and
  sets `source: "pending"`; the route still returns a probe.
- **Fallback order.** A pending model with no beliefs walks `CATEGORIES` in
  order.
- **Validation.** `readProfileModel` rejects a wrong version, drops unknown
  topic ids, clamps out-of-range `p` and `certainty`, and caps evidence length.
- **Catalog integrity.** Every `ProbeTopic` id exists in `TOPICS`, names a real
  `CATEGORIES` entry, and carries exactly four claims.
