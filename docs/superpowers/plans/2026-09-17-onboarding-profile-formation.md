# Onboarding Profile Formation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Rubicon's onboarding from a questionnaire into two tactile foundation drags that materially reshape everything downstream, with a profile card that builds itself alongside.

**Architecture:** Two scene components replace `FoundationScale`: a lens that consolidates a field of future-fragments, and a traveler that draws a trading instrument into existence behind them. Confidence then selects one of four instruments at `SCENE.deck`, all of which write the same seven `PredictionResponse` entries so coverage never varies. The flow file keeps orchestration only.

**Tech Stack:** Next.js App Router, React 19 client components, TypeScript, plain CSS (no Tailwind in onboarding), GSAP via `app/_components/motion`, Vitest with `happy-dom` and raw `react-dom/client` + `act` (no Testing Library).

## Global Constraints

- **Coverage is invariant.** Every confidence path produces exactly seven `PredictionResponse` entries, one per `CATEGORIES` domain. Never vary coverage by confidence.
- **The `.onb-choices` button grid keeps its current styling** — `01` mono numerals, label, `EXPERIENCE_NOTES` subtitles, accent-wash `aria-pressed` state. Do not restyle it.
- **The only blue is `#2f7df6`** (`--onb-accent`). Primary buttons stay ink.
- **Accent variables already exist** on `.onb`: `--onb-accent`, `--onb-accent-deep`, `--onb-accent-soft`, `--onb-accent-pale`, `--onb-accent-wash`, `--onb-accent-line`, `--onb-ink-rgb`. Use them; do not add new colour literals.
- **Reduced motion:** under `prefers-reduced-motion: reduce`, drift and transitions are removed. Blur and clipping remain — they are state, not motion.
- **Test command is `npm test`** (`vitest run`). Component tests start with `// @vitest-environment happy-dom` and use `createRoot` + `act`, matching `app/(hub)/social-trading.test.tsx`.
- **Existing tests must keep passing.** `social-trading.test.tsx` drives onboarding by clicking the stop labels (`await click("Experienced")`), which is why the button grid stays.
- **Typecheck with `npm run typecheck`** before every commit.

---

### Task 1: Prediction notes and the instrument selector

**Files:**
- Modify: `lib/socialtrading/onboarding.ts`
- Test: `lib/socialtrading/onboarding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Instrument = "deck" | "field" | "sorter" | "thesis"`; `instrumentFor(confidence: number | null): Instrument`; `NOTE_MAX: 140`; `PredictionResponse.note?: string`; `onboardingThesis` emits `Why: <note>` for strongest views carrying a note.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("decision-tree onboarding", ...)` block in `lib/socialtrading/onboarding.test.ts`:

```ts
  it("maps each confidence stop to its instrument, defaulting an unanswered scale to the deck", () => {
    expect(instrumentFor(0)).toBe("deck");
    expect(instrumentFor(1)).toBe("field");
    expect(instrumentFor(2)).toBe("sorter");
    expect(instrumentFor(3)).toBe("thesis");
    expect(instrumentFor(null)).toBe("deck");
    expect(instrumentFor(99)).toBe("thesis");
    expect(instrumentFor(-4)).toBe("deck");
  });
  it("keeps a reason behind a strongest view and carries it into the thesis", () => {
    const a = newOnboarding();
    a.responses = [{ ...predictions(1)[0], direction: "yes", note: "Warehouses already run this way." }];
    a.strongest = [a.responses[0].id];
    expect(onboardingThesis(a)).toContain("Why: Warehouses already run this way.");
    const withoutNote = { ...a, responses: [{ ...a.responses[0], note: undefined }] };
    expect(onboardingThesis(withoutNote)).not.toContain("Why:");
  });
  it("sanitizes notes without discarding the response that carries them", () => {
    const base = predictions(0)[0];
    const a = readOnboarding({ ...newOnboarding(),
      responses: [
        { ...base, direction: "yes", note: "x".repeat(400) },
        { ...predictions(0)[1], direction: "no", note: 42 },
        { ...predictions(0)[2], direction: "yes", note: "   " },
      ] })!;
    expect(a.responses).toHaveLength(3);
    expect(a.responses[0].note).toHaveLength(140);
    expect(a.responses[1].note).toBeUndefined();
    expect(a.responses[2].note).toBeUndefined();
  });
```

Extend that file's import on line 2 to include the new exports:

```ts
import { CATEGORIES, DISLIKES, instrumentFor, needsGeography, newOnboarding, onboardingThesis, predictions, readOnboarding, resolveScene, sceneOrder } from "./onboarding";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/socialtrading/onboarding.test.ts`
Expected: FAIL — `instrumentFor is not a function`.

- [ ] **Step 3: Implement**

In `lib/socialtrading/onboarding.ts`, replace the `PredictionResponse` type line with:

```ts
export const NOTE_MAX = 140;
export type PredictionResponse = { id: string; category: string; text: string; direction: "yes" | "no" | "unsure"; confidence?: number; years?: number; note?: string };
/** Confidence picks the instrument, never the coverage: every path still
 * answers all seven domains, so profiles stay comparable. */
export type Instrument = "deck" | "field" | "sorter" | "thesis";
const INSTRUMENTS: readonly Instrument[] = ["deck", "field", "sorter", "thesis"];
export const instrumentFor = (confidence: number | null) => INSTRUMENTS[Math.max(0, Math.min(3, confidence ?? 0))];
```

In `readOnboarding`, inside the `.map(p => ({ ... }))` for responses, add a final spread after the `years` spread:

```ts
        ...(typeof p.note === "string" && p.note.trim() ? { note: p.note.slice(0, NOTE_MAX) } : {}),
```

In `onboardingThesis`, replace the `selected.map(...)` body with:

```ts
  return [...selected.map(r => `${r.direction === "yes" ? "I expect" : "I do not expect"}: ${r.text}${r.confidence ? ` Confidence in this view: ${r.confidence}%.` : ""}${r.years ? ` Horizon: ${r.years === 11 ? "more than ten" : r.years} years.` : ""}${r.note?.trim() ? ` Why: ${r.note.trim()}` : ""}`), a.ownBelief.trim()].filter(Boolean).join("\n") || "I’m exploring possible futures and have not settled on a strong conviction yet.";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/socialtrading/onboarding.test.ts`
Expected: PASS, all eight cases in the file.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/socialtrading/onboarding.ts lib/socialtrading/onboarding.test.ts
git commit -m "feat: a prediction can carry the reason behind it"
```

---

### Task 2: Domain detection for the conviction path

**Files:**
- Modify: `lib/socialtrading/onboarding.ts`
- Test: `lib/socialtrading/onboarding.test.ts`

**Interfaces:**
- Consumes: `CATEGORIES` from Task 1's file.
- Produces: `domainsTouched(text: string): string[]` — returns the subset of `CATEGORIES` whose keywords appear in the text, in `CATEGORIES` order.

**Why this exists:** the spec said to reuse `suggestedThemes()`, but `lib/socialtrading/themes.ts:12` matches only six themes covering five of the seven domains — "Government and geopolitics", "Climate and infrastructure" and "Society and work" have no theme. A per-domain matcher is needed, following the `GEOGRAPHY_WORDS` precedent already in this file.

- [ ] **Step 1: Write the failing test**

Append to `lib/socialtrading/onboarding.test.ts`:

```ts
  it("detects only the domains a belief actually names, in category order", () => {
    expect(domainsTouched("")).toEqual([]);
    expect(domainsTouched("Robots and AI take over warehouse work."))
      .toEqual(["Technology", "Society and work"]);
    expect(domainsTouched("Electricity demand outruns the grid, and climate adaptation gets expensive."))
      .toEqual(["Energy", "Climate and infrastructure"]);
    expect(domainsTouched("Stablecoins become normal while tariffs reshape supply chains."))
      .toEqual(["Money and crypto", "Government and geopolitics"]);
    expect(domainsTouched("An ageing population makes biotech matter more."))
      .toEqual(["Health and demographics"]);
    // Every returned name is a real category, and nothing is reported twice.
    const all = domainsTouched("AI power crypto biotech tariffs climate jobs");
    expect(all).toEqual(CATEGORIES);
    expect(new Set(all).size).toBe(all.length);
    // "agent" must not read as "age".
    expect(domainsTouched("My agent should be patient.")).toEqual([]);
  });
```

Extend the import on line 2 to include `domainsTouched`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/socialtrading/onboarding.test.ts`
Expected: FAIL — `domainsTouched is not a function`.

- [ ] **Step 3: Implement**

Add to `lib/socialtrading/onboarding.ts`, directly below the `GEOGRAPHY_WORDS` constant:

```ts
/** One matcher per domain, in CATEGORIES order. Used only to show a conviction
 * writer which domains their own words already covered; a miss simply means
 * that domain gets asked, so the matcher may be under-eager but is never
 * allowed to assert a view the person did not express. */
const DOMAIN_WORDS: readonly RegExp[] = [
  /\b(ai|artificial intelligence|robot\w*|automat\w*|software|semiconductors?|chips?|comput\w*|cloud|data cent\w*|gpus?|tech|technolog\w*)\b/i,
  /\b(energy|electric\w*|power|grid|nuclear|solar|wind|uranium|oil|gas|fossil|batter\w*|utilit\w*)\b/i,
  /\b(crypto\w*|bitcoin|ethereum|blockchain|stablecoins?|tokens?|defi|banks?|banking|payments?|money|currenc\w*|dollar)\b/i,
  /\b(health\w*|biotech\w*|medicine|medical|drugs?|pharma\w*|longevity|ageing|aging|elderly|demograph\w*|population)\b/i,
  /\b(government\w*|geopolit\w*|defen[cs]e|military|war|conflict|sanction\w*|tariff\w*|deglobali[sz]\w*|reshor\w*|supply chains?|china|russia|taiwan|nato|ukraine|regulat\w*|polic(y|ies))\b/i,
  /\b(climate|carbon|emissions?|warming|infrastructure|adaptation|water|flood\w*|drought|construction|transit|rail)\b/i,
  /\b(work|works|working|jobs?|labou?r|employ\w*|educat\w*|societ\w*|social|hous(ing|es)|wages?|skills?|workforce)\b/i,
];
/** The domains a freeform belief already names, in CATEGORIES order. */
export const domainsTouched = (text: string) => CATEGORIES.filter((_, i) => DOMAIN_WORDS[i].test(text));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/socialtrading/onboarding.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/socialtrading/onboarding.ts lib/socialtrading/onboarding.test.ts
git commit -m "feat: a written belief reveals which domains it already covers"
```

---

### Task 3: The merged stop rail

**Files:**
- Modify: `app/(hub)/onboarding-drag.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: Create `app/(hub)/onboarding-rail.test.tsx`

**Interfaces:**
- Consumes: `useDrag`, `SmoothRange`, `clamp`, `intervalAt`, `intervalCenter` from `onboarding-drag.tsx` (all already exported).
- Produces: `StopRail({ labels, position, onChange, label }: { labels: readonly string[]; position: number; onChange: (position: number) => void; label: string })` — renders the native range plus four tick buttons; clicking tick `i` calls `onChange(intervalCenter(i))`.

- [ ] **Step 1: Write the failing test**

Create `app/(hub)/onboarding-rail.test.tsx`:

```tsx
// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StopRail } from "./onboarding-drag";
import { intervalCenter } from "./onboarding-drag";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const LABELS = ["One", "Two", "Three", "Four"] as const;

it("jumps to the stop under a tick and names the current stop to assistive tech", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(<StopRail labels={LABELS} position={0.125} onChange={onChange} label="Test scale" />));
  const range = container.querySelector('input[type="range"][aria-label="Test scale"]') as HTMLInputElement;
  expect(range).toBeTruthy();
  expect(range.getAttribute("aria-valuetext")).toBe("One");
  const ticks = Array.from(container.querySelectorAll(".onb-rail-ticks button"));
  expect(ticks).toHaveLength(4);
  await act(async () => ticks[2].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(onChange).toHaveBeenCalledWith(intervalCenter(2));
});

it("prints only the stop the position falls in", async () => {
  await act(async () => root.render(<StopRail labels={LABELS} position={0.875} onChange={() => {}} label="Test scale" />));
  expect(container.querySelector(".onb-rail-label")!.textContent).toBe("Four");
  expect(container.textContent).not.toContain("One");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-rail.test.tsx`
Expected: FAIL — `StopRail` is not exported from `./onboarding-drag`.

- [ ] **Step 3: Implement**

Add to `app/(hub)/onboarding-drag.tsx`, directly after `SmoothRange`:

```tsx
/** One control for a four-stop scale: the native range owns keyboard and
 * assistive input, the ticks are pointer shortcuts, and only the stop the
 * position falls in is ever printed. */
export function StopRail({ labels, position, onChange, label }: {
  labels: readonly string[]; position: number; onChange: (position: number) => void; label: string;
}) {
  const current = labels[intervalAt(position)];
  return <div className="onb-rail">
    <SmoothRange className="onb-scale-control" label={label} value={position} valueText={current} onChange={onChange} />
    <div className="onb-rail-ticks" aria-hidden="true">
      {labels.map((stop, i) => <button key={stop} type="button" tabIndex={-1} data-active={intervalAt(position) === i || undefined} onClick={() => onChange(intervalCenter(i))} />)}
    </div>
    <p className="onb-rail-label" role="status" aria-live="polite">{current}</p>
  </div>;
}
```

Append to `app/(hub)/onboarding.css`, after the `.onb-scale-control` rule:

```css
/* The rail: one control, four shortcuts, one label. */
.onb-rail { display: grid; gap: .35rem; margin-top: -.25rem; }
.onb-rail-ticks { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 0 .6875rem; }
.onb-rail-ticks button { height: 1.25rem; border: 0; background: none; position: relative; }
.onb-rail-ticks button::before { content: ""; position: absolute; top: 0; left: 50%; width: 1px; height: .45rem; background: rgba(var(--onb-ink-rgb), .18); transform: translateX(-50%); transition: background-color 140ms ease, height 140ms ease; }
.onb-rail-ticks button:hover::before, .onb-rail-ticks button[data-active]::before { background: var(--onb-accent); height: .6rem; }
.onb-rail-label { font-size: 1.05rem; font-weight: 500; letter-spacing: -.015em; color: var(--ink); min-height: 1.6rem; }
@media (prefers-reduced-motion: reduce) { .onb-rail-ticks button::before { transition: none; } }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- app/\(hub\)/onboarding-rail.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-drag.tsx" "app/(hub)/onboarding.css" "app/(hub)/onboarding-rail.test.tsx"
git commit -m "feat: one rail carries the four stops"
```

---

### Task 4: The focus scene

**Files:**
- Create: `app/(hub)/onboarding-focus.tsx`
- Modify: `app/(hub)/onboarding-flow.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: Create `app/(hub)/onboarding-focus.test.tsx`

**Interfaces:**
- Consumes: `useDrag`, `StopRail`, `intervalAt`, `intervalCenter` from `./onboarding-drag`; `CONFIDENCE` from `@/lib/socialtrading/onboarding`.
- Produces: `FocusScene({ value, onChange }: { value: number | null; onChange: (value: number) => void })`; `FRAGMENTS: readonly { text: string; keep: 0|1|2|3; x: number; y: number }[]`; `visibleFragments(stop: number)` returning the fragments showing at that stop.

- [ ] **Step 1: Write the failing test**

Create `app/(hub)/onboarding-focus.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { FRAGMENTS, visibleFragments } from "./onboarding-focus";

it("consolidates the field as the lens sharpens", () => {
  expect(visibleFragments(0)).toHaveLength(20);
  expect(visibleFragments(1)).toHaveLength(12);
  expect(visibleFragments(2)).toHaveLength(7);
  expect(visibleFragments(3)).toHaveLength(4);
});

it("never shows a fragment that an earlier stop had already dropped", () => {
  for (let stop = 1; stop <= 3; stop++) {
    const survivors = new Set(visibleFragments(stop).map(f => f.text));
    for (const text of survivors) expect(visibleFragments(stop - 1).map(f => f.text)).toContain(text);
  }
});

it("places every fragment inside the stage", () => {
  expect(FRAGMENTS).toHaveLength(20);
  expect(new Set(FRAGMENTS.map(f => f.text)).size).toBe(20);
  for (const f of FRAGMENTS) {
    expect(f.x).toBeGreaterThanOrEqual(4);
    expect(f.x).toBeLessThanOrEqual(96);
    expect(f.y).toBeGreaterThanOrEqual(8);
    expect(f.y).toBeLessThanOrEqual(92);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-focus.test.tsx`
Expected: FAIL — cannot resolve `./onboarding-focus`.

- [ ] **Step 3: Implement the scene**

Create `app/(hub)/onboarding-focus.tsx`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { CONFIDENCE } from "@/lib/socialtrading/onboarding";
import { StopRail, intervalAt, intervalCenter, useDrag } from "./onboarding-drag";

/** `keep` is the last stop at which a fragment still shows. Sharpening the
 * lens drops the vague ones, so twenty possibilities become four convictions:
 * the interaction shows the trade the person is about to make. */
export const FRAGMENTS = [
  { text: "Robots do the physical work", keep: 3, x: 26, y: 30 },
  { text: "Power becomes the constraint", keep: 3, x: 71, y: 26 },
  { text: "Stablecoins go mainstream", keep: 3, x: 33, y: 71 },
  { text: "Ageing reshapes everything", keep: 3, x: 74, y: 68 },
  { text: "Factories come home", keep: 2, x: 50, y: 15 },
  { text: "Adaptation outspends prevention", keep: 2, x: 14, y: 52 },
  { text: "AI lands in every job", keep: 2, x: 88, y: 48 },
  { text: "Grids get rebuilt", keep: 1, x: 42, y: 47 },
  { text: "Water becomes political", keep: 1, x: 62, y: 86 },
  { text: "Chips stay scarce", keep: 1, x: 18, y: 85 },
  { text: "Banks quietly adopt chains", keep: 1, x: 84, y: 12 },
  { text: "Work splits in two", keep: 1, x: 8, y: 16 },
  { text: "Drugs get designed faster", keep: 0, x: 57, y: 58 },
  { text: "Trade routes redraw", keep: 0, x: 30, y: 10 },
  { text: "Cities densify", keep: 0, x: 93, y: 78 },
  { text: "Storage beats generation", keep: 0, x: 66, y: 40 },
  { text: "Attention gets priced", keep: 0, x: 46, y: 90 },
  { text: "Borders harden", keep: 0, x: 6, y: 68 },
  { text: "Housing stays stuck", keep: 0, x: 79, y: 90 },
  { text: "Compute moves to the edge", keep: 0, x: 22, y: 62 },
] as const;

export const visibleFragments = (stop: number) => FRAGMENTS.filter(f => f.keep >= stop);

/** Four blurred wrappers instead of twenty: the filter is applied per band, so
 * the page carries eight blurred nodes rather than forty. */
const BANDS = [0, 1, 2, 3] as const;

function Field({ lens = false }: { lens?: boolean }) {
  return <div className={`onb-field-layer${lens ? " is-lens" : ""}`} aria-hidden="true">
    {BANDS.map(band => <div key={band} className="onb-band" style={{ "--keep": band } as CSSProperties}>
      {FRAGMENTS.filter(f => f.keep === band).map(f => <span key={f.text} className="onb-fragment" style={{ "--x": `${f.x}%`, "--y": `${f.y}%` } as CSSProperties}>{f.text}</span>)}
    </div>)}
  </div>;
}

export function FocusScene({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  const [position, setPosition] = useState(value === null ? 0 : intervalCenter(Math.min(3, value)));
  function change(next: number) { setPosition(next); const stop = intervalAt(next); if (value !== stop) onChange(stop); }
  const scene = useDrag<HTMLDivElement>({ min: 0, max: 1, value: position, onChange: change }, null, { pad: 24 });
  const { dragging, ...handlers } = scene;
  return <>
    <div className="onb-scene is-focus" data-dragging={dragging || undefined} style={{ "--position": position, "--focus": position * 3 } as CSSProperties} {...handlers} aria-hidden="true">
      <Field />
      <Field lens />
      <div className="onb-lens"><span /></div>
    </div>
    <StopRail labels={CONFIDENCE} position={position} onChange={change} label="Clarity of your beliefs" />
  </>;
}
```

- [ ] **Step 4: Add the styles**

In `app/(hub)/onboarding.css`, replace the `.onb-scene.is-clarity`, `.onb-focus-field` and `.onb-focus-line` rules with:

```css
.onb-scene.is-focus { height: 19rem; background: radial-gradient(ellipse at 50% 120%, var(--onb-accent-wash), transparent 60%), var(--card); }
.onb-field-layer { position: absolute; inset: 0; }
/* The lens is a real optic: the same field, sharp, showing only through the ring. */
.onb-field-layer.is-lens { --focus: 3; clip-path: circle(4.75rem at calc(4.75rem + var(--position) * (100% - 9.5rem)) 50%); }
.onb-band { position: absolute; inset: 0; filter: blur(calc(max(0px, 3 - var(--focus)) * 2.4px)); opacity: clamp(0, calc(var(--keep) + 1 - var(--focus)), 1); transition: opacity 180ms ease; }
.onb-fragment { position: absolute; left: var(--x); top: var(--y); transform: translate(-50%, -50%); width: max-content; max-width: 40%; color: var(--ink); font-size: calc(.78rem + var(--focus) * .16rem); font-weight: 500; letter-spacing: -.015em; line-height: 1.35; text-align: center; opacity: calc(.4 + var(--focus) * .2); transition: font-size 180ms ease, opacity 180ms ease; }
@media (prefers-reduced-motion: reduce) { .onb-band, .onb-fragment { transition: none; } }
```

- [ ] **Step 5: Wire it into the flow**

In `app/(hub)/onboarding-flow.tsx`:

Replace the `FoundationScale` import line with:

```tsx
import { DraggableDislike } from "./onboarding-drag";
import { FocusScene } from "./onboarding-focus";
```

Replace the clarity scene line with:

```tsx
          {scene === SCENE.clarity && <FocusScene value={a.confidence} onChange={confidence => update({ confidence })} />}
```

In the header, suppress the lead on the two foundation scenes. Replace the `<header className="onb-heading">` element with:

```tsx
        <header className="onb-heading"><span className="onb-eyebrow">{eyebrow}</span><h1 ref={heading} tabIndex={-1} className="landing-hero-title outline-none">{TITLES[scene]}</h1>{scene > SCENE.knowledge && <p className="landing-hero-lead socialtrading-lead">{NOTES[scene]}</p>}</header>
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS. `social-trading.test.tsx` still drives clarity through `await click("I know what I believe")` on the retained `.onb-choices` grid, which `FocusScene` does not render — so this run is expected to FAIL on those cases. That is why Step 7 exists; do not skip it.

- [ ] **Step 7: Restore the button grid below the scene**

The `.onb-choices` grid stays. Add it back inside `FocusScene`, after `StopRail`, in `app/(hub)/onboarding-focus.tsx`:

```tsx
    <div className="onb-choices">{CONFIDENCE.map((stop, i) => <button key={stop} type="button" aria-pressed={value === i} onClick={() => { setPosition(intervalCenter(i)); onChange(i); }}><span className="mono">0{i + 1}</span><strong>{stop}</strong></button>)}</div>
```

- [ ] **Step 8: Run the full suite again**

Run: `npm test`
Expected: PASS, including every case in `social-trading.test.tsx`.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-focus.tsx" "app/(hub)/onboarding-focus.test.tsx" "app/(hub)/onboarding-flow.tsx" "app/(hub)/onboarding.css"
git commit -m "feat: the lens consolidates twenty possibilities into four convictions"
```

---

### Task 5: The trail scene

**Files:**
- Create: `app/(hub)/onboarding-trail.tsx`
- Modify: `app/(hub)/onboarding-drag.tsx` (remove `FoundationScale`)
- Modify: `app/(hub)/onboarding-flow.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: Create `app/(hub)/onboarding-trail.test.tsx`

**Interfaces:**
- Consumes: `useDrag`, `StopRail`, `intervalAt`, `intervalCenter` from `./onboarding-drag`; `EXPERIENCE`, `EXPERIENCE_NOTES` from `@/lib/socialtrading/onboarding`.
- Produces: `TrailScene({ value, onChange }: { value: number | null; onChange: (value: number) => void })`; `trailY(position: number): number`; `LAYERS: readonly { id: string; from: 0|1|2|3 }[]`.

- [ ] **Step 1: Write the failing test**

Create `app/(hub)/onboarding-trail.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { LAYERS, trailY } from "./onboarding-trail";

it("builds the instrument stop by stop and never takes a layer away", () => {
  const at = (stop: number) => LAYERS.filter(l => l.from <= stop).map(l => l.id);
  expect(at(0)).toEqual(["path"]);
  expect(at(1)).toEqual(["path", "line", "area", "baseline"]);
  expect(at(2)).toEqual(["path", "line", "area", "baseline", "candles", "axis", "volume"]);
  expect(at(3)).toEqual(["path", "line", "area", "baseline", "candles", "axis", "volume", "average", "compare", "pins", "readout"]);
  for (let stop = 1; stop <= 3; stop++) for (const id of at(stop - 1)) expect(at(stop)).toContain(id);
});

it("keeps the trail inside its viewBox at every position", () => {
  for (let i = 0; i <= 20; i++) {
    const y = trailY(i / 20);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(160);
  }
  expect(trailY(0)).toBeCloseTo(96, 5);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-trail.test.tsx`
Expected: FAIL — cannot resolve `./onboarding-trail`.

- [ ] **Step 3: Implement the scene**

Create `app/(hub)/onboarding-trail.tsx`:

```tsx
"use client";

import { useState, type CSSProperties } from "react";
import { PersonStanding } from "lucide-react";
import { EXPERIENCE, EXPERIENCE_NOTES } from "@/lib/socialtrading/onboarding";
import { StopRail, intervalAt, intervalCenter, useDrag } from "./onboarding-drag";

/** The environment getting richer is the instrument assembling. Every layer is
 * clipped to the traveler, so ahead of them is bare path and behind them the
 * instrument exists: the drag draws it into being rather than switching state. */
export const LAYERS = [
  { id: "path", from: 0 }, { id: "line", from: 1 }, { id: "area", from: 1 }, { id: "baseline", from: 1 },
  { id: "candles", from: 2 }, { id: "axis", from: 2 }, { id: "volume", from: 2 },
  { id: "average", from: 3 }, { id: "compare", from: 3 }, { id: "pins", from: 3 }, { id: "readout", from: 3 },
] as const;

export const trailY = (position: number) => 96 - 38 * Math.sin(position * 4 * Math.PI);

const X = (position: number) => 40 + position * 760;
const CANDLES = [.09, .17, .25, .33, .41, .49, .57, .65, .73, .81, .89];

export function TrailScene({ value, onChange }: { value: number | null; onChange: (value: number) => void }) {
  const [position, setPosition] = useState(value === null ? 0 : intervalCenter(Math.min(3, value)));
  const stop = intervalAt(position);
  function change(next: number) { setPosition(next); const s = intervalAt(next); if (value !== s) onChange(s); }
  const scene = useDrag<HTMLDivElement>({ min: 0, max: 1, value: position, onChange: change }, null, { pad: 24 });
  const { dragging, ...handlers } = scene;
  const shows = (id: typeof LAYERS[number]["id"]) => stop >= LAYERS.find(l => l.id === id)!.from;
  return <>
    <div className="onb-scene is-trail" data-dragging={dragging || undefined} style={{ "--position": position } as CSSProperties} {...handlers} aria-hidden="true">
      <svg viewBox="0 0 800 160" preserveAspectRatio="none">
        <defs><clipPath id="onb-built" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="var(--position)" height="1" /></clipPath></defs>
        <path className="onb-trail-path" d="M40 96 Q135 20 230 96 T420 96 T610 96 T800 96" />
        <g className="onb-built" clipPath="url(#onb-built)">
          {shows("area") && <path className="onb-trail-area" d="M40 96 Q135 20 230 96 T420 96 T610 96 T800 96 L800 160 L40 160 Z" />}
          {shows("line") && <path className="onb-trail-line" d="M40 96 Q135 20 230 96 T420 96 T610 96 T800 96" />}
          {shows("baseline") && <line className="onb-trail-baseline" x1="40" y1="140" x2="800" y2="140" />}
          {shows("volume") && CANDLES.map(p => <rect key={`v${p}`} className="onb-trail-volume" x={X(p) - 4} y={148 - (8 + 14 * Math.abs(Math.sin(p * 9)))} width="8" height={8 + 14 * Math.abs(Math.sin(p * 9))} />)}
          {shows("candles") && CANDLES.map(p => <rect key={`c${p}`} className="onb-trail-candle" x={X(p) - 3} y={trailY(p) - 11} width="6" height="22" />)}
          {shows("average") && <path className="onb-trail-average" d="M40 104 C 200 78 320 108 460 92 S 700 96 800 88" />}
          {shows("compare") && <path className="onb-trail-compare" d="M40 118 C 220 112 340 128 470 108 S 690 118 800 104" />}
          {shows("pins") && [.31, .72].map(p => <g key={`p${p}`} className="onb-trail-pin"><circle cx={X(p)} cy={trailY(p)} r="4.5" /><line x1={X(p)} y1={trailY(p) - 6} x2={X(p)} y2={trailY(p) - 24} /></g>)}
        </g>
        {shows("axis") && <g className="onb-trail-axis">{[36, 68, 100, 132].map(y => <text key={y} x="8" y={y + 4}>{(180 - y).toFixed(0)}</text>)}</g>}
      </svg>
      {shows("readout") && <div className="onb-trail-readout"><span>RANGE <strong>142.6</strong></span><span>CHG <strong>+2.4%</strong></span><span>VOL <strong>3.1M</strong></span></div>}
      <div className="onb-traveler" style={{ left: `${5 + position * 95}%`, top: `${trailY(position) / 160 * 100}%` }}><PersonStanding size={26} strokeWidth={1.6} /></div>
    </div>
    <StopRail labels={EXPERIENCE} position={position} onChange={change} label="Investment knowledge" />
    <div className="onb-choices has-notes">{EXPERIENCE.map((label, i) => <button key={label} type="button" aria-pressed={value === i} onClick={() => { setPosition(intervalCenter(i)); onChange(i); }}><span className="mono">0{i + 1}</span><strong>{label}</strong><small>{EXPERIENCE_NOTES[i]}</small></button>)}</div>
  </>;
}
```

Note on the clip: SVG `clipPathUnits="objectBoundingBox"` cannot read a CSS variable in a `width` attribute. Replace the `<defs>` line above with a clip driven from React instead:

```tsx
        <defs><clipPath id="onb-built"><rect x="0" y="0" width={X(position)} height="160" /></clipPath></defs>
```

- [ ] **Step 4: Add the styles**

In `app/(hub)/onboarding.css`, replace the `.onb-scene.is-knowledge svg` rule with:

```css
.onb-scene.is-trail { height: 19rem; }
.onb-scene.is-trail svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.onb-trail-line { fill: none; stroke: var(--ink); stroke-width: 2; vector-effect: non-scaling-stroke; }
.onb-trail-area { fill: var(--onb-accent-wash); stroke: none; }
.onb-trail-baseline { stroke: rgba(var(--onb-ink-rgb), .12); stroke-width: 1; vector-effect: non-scaling-stroke; }
.onb-trail-candle { fill: var(--onb-accent); opacity: .55; }
.onb-trail-volume { fill: rgba(var(--onb-ink-rgb), .1); }
.onb-trail-average { fill: none; stroke: var(--onb-accent-deep); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.onb-trail-compare { fill: none; stroke: rgba(var(--onb-ink-rgb), .3); stroke-width: 1.5; stroke-dasharray: 4 5; vector-effect: non-scaling-stroke; }
.onb-trail-pin circle { fill: var(--card); stroke: var(--onb-accent-deep); stroke-width: 1.5; vector-effect: non-scaling-stroke; }
.onb-trail-pin line { stroke: var(--onb-accent-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.onb-trail-axis text { fill: var(--quiet); font-size: 9px; font-family: var(--font-mono, monospace); }
.onb-trail-readout { position: absolute; right: .9rem; top: .9rem; display: flex; gap: 1rem; font-size: .62rem; letter-spacing: .08em; color: var(--quiet); }
.onb-trail-readout strong { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 5: Wire it in and retire `FoundationScale`**

In `app/(hub)/onboarding-flow.tsx`, add the import:

```tsx
import { TrailScene } from "./onboarding-trail";
```

Replace the knowledge scene block with:

```tsx
          {scene === SCENE.knowledge && <TrailScene value={profile.investorAnswers.knowledge} onChange={knowledge => update({ responses: [], strongest: [] }, { investorAnswers: { ...profile.investorAnswers, knowledge } })} />}
```

Delete the `FoundationScale` function from `app/(hub)/onboarding-drag.tsx` entirely, along with its now-unused `PersonStanding` and `CONFIDENCE, EXPERIENCE, EXPERIENCE_NOTES` imports.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, including `social-trading.test.tsx`'s `foundation()` helper, which clicks `"Experienced"` on the retained grid.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-trail.tsx" "app/(hub)/onboarding-trail.test.tsx" "app/(hub)/onboarding-drag.tsx" "app/(hub)/onboarding-flow.tsx" "app/(hub)/onboarding.css"
git commit -m "feat: the traveler draws the instrument into existence"
```

---

### Task 6: Extract the deck behind an instrument switch

**Files:**
- Create: `app/(hub)/onboarding-instruments.tsx`
- Modify: `app/(hub)/onboarding-flow.tsx`
- Test: `app/(hub)/social-trading.test.tsx` (existing cases are the test)

**Interfaces:**
- Consumes: `instrumentFor`, `predictions`, `PredictionResponse`, `CATEGORIES` from `@/lib/socialtrading/onboarding`.
- Produces: `Instruments({ instrument, deck, responses, onAnswer, onUndo }: { instrument: Instrument; deck: ReturnType<typeof predictions>; responses: PredictionResponse[]; onAnswer: (response: PredictionResponse) => void; onUndo: () => void })`. `onAnswer` appends exactly one response; the flow decides when seven have landed.

This task moves the existing swipe deck with **no behaviour change**. All four instrument branches render the deck; Tasks 7–9 replace three of them.

- [ ] **Step 1: Create the file with the shared types**

Create `app/(hub)/onboarding-instruments.tsx` as a `"use client"` module, starting with the two types every instrument shares. Tasks 7, 8 and 9 all depend on these exact names:

```tsx
"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowDown, RotateCcw, Bot, Zap, Coins, HeartPulse, Globe2, Sprout, BriefcaseBusiness } from "lucide-react";
import { CATEGORIES, NOTE_MAX, domainsTouched, predictions, type Instrument, type PredictionResponse } from "@/lib/socialtrading/onboarding";

/** One unanswered possibility, exactly what `predictions()` returns. */
export type Prediction = ReturnType<typeof predictions>[number];
/** Every instrument answers the same seven domains and reports one response at
 * a time; the flow decides when all seven have landed. `onAnswer` upserts by
 * id, so an instrument may revise an answer it already gave. */
export type InstrumentProps = {
  deck: Prediction[];
  responses: PredictionResponse[];
  onAnswer: (response: PredictionResponse) => void;
  onUndo: () => void;
};
```

- [ ] **Step 2: Move the deck across verbatim**

Move the entire `scene === SCENE.deck` JSX block out of `onboarding-flow.tsx` into a `Deck({ deck, responses, onAnswer, onUndo }: InstrumentProps)` component, together with the state it owns: `drag`, `pointer`, `swipeCard`, `swipeLocked`, `swipeAnimation`, `swipeExiting`, the `vote` function, the `SWIPE` constant and the `ICONS` array. The one behavioural substitution: where `vote` did `update({ responses: [...a.responses, { ...prediction, direction }], scene: ... })`, it now calls `onAnswer({ ...prediction, direction })` and nothing else — scene advancement moves to the flow. The `Undo last swipe` button calls `onUndo()`.

Then export the entry point. It takes `instrument` now because the flow already passes it, but only the deck exists yet — Tasks 7, 8 and 9 each add their own `case` above the fallback as they land. Do not write dead `case` arms that return the deck, and do not add `belief`/`onBelief` yet; Task 9 introduces them when the thesis instrument needs them.

```tsx
export function Instruments({ instrument, ...rest }: InstrumentProps & { instrument: Instrument }) {
  // Tasks 7-9 add "field", "sorter" and "thesis" here. Until then every
  // confidence stop answers the same seven domains through the deck.
  void instrument;
  return <Deck {...rest} />;
}
```

- [ ] **Step 3: Wire the flow to it**

In `app/(hub)/onboarding-flow.tsx`, replace the deck JSX block with:

```tsx
          {scene === SCENE.deck && <Instruments instrument={instrumentFor(a.confidence)} deck={deck} responses={a.responses} onAnswer={response => update({ responses: [...a.responses, response], scene: a.responses.length === 6 ? SCENE.strongest : SCENE.deck })} onUndo={() => update({ responses: a.responses.slice(0, -1), strongest: [] })} />}
```

Add `Instruments` and `instrumentFor` to the imports, and delete the swipe state and `vote` function that moved out.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS with no changes to any test file. If a case fails, the move was not behaviour-preserving — fix the move, do not edit the test.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-instruments.tsx" "app/(hub)/onboarding-flow.tsx"
git commit -m "refactor: the flow orchestrates, the instruments answer"
```

---

### Task 7: The Field instrument (a few hunches)

**Files:**
- Modify: `app/(hub)/onboarding-instruments.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: Create `app/(hub)/onboarding-instruments.test.tsx`

**Interfaces:**
- Consumes: `Instruments` from Task 6; `NOTE_MAX` from `@/lib/socialtrading/onboarding`.
- Produces: `Field` rendered when `instrument === "field"`. All seven tiles are on screen; first tap leans toward, second tap leans against, third returns to unanswered. Any answered tile reveals a one-line thought input capped at `NOTE_MAX`.

- [ ] **Step 1: Write the failing test**

Create `app/(hub)/onboarding-instruments.test.tsx`:

```tsx
// @vitest-environment happy-dom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { predictions, type PredictionResponse } from "@/lib/socialtrading/onboarding";
import { Instruments } from "./onboarding-instruments";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function click(el: Element) { await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true }))); }

it("shows all seven domains at once and cycles a tile through toward, against, unanswered", async () => {
  const answered: PredictionResponse[] = [];
  const deck = predictions(1);
  await act(async () => root.render(<Instruments instrument="field" deck={deck} responses={[]} onAnswer={r => answered.push(r)} onUndo={() => {}} />));
  const tiles = Array.from(container.querySelectorAll(".onb-tile"));
  expect(tiles).toHaveLength(7);
  await click(tiles[0].querySelector("button")!);
  expect(answered.at(-1)).toMatchObject({ id: deck[0].id, direction: "yes" });
  await click(tiles[0].querySelector("button")!);
  expect(answered.at(-1)).toMatchObject({ id: deck[0].id, direction: "no" });
});

it("caps a thought at the note limit", async () => {
  const deck = predictions(1);
  const answered: PredictionResponse[] = [];
  await act(async () => root.render(<Instruments instrument="field" deck={deck} responses={[{ ...deck[0], direction: "yes" }]} onAnswer={r => answered.push(r)} onUndo={() => {}} />));
  const note = container.querySelector(".onb-tile input[type='text']") as HTMLInputElement;
  expect(note).toBeTruthy();
  expect(note.maxLength).toBe(140);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-instruments.test.tsx`
Expected: FAIL — `.onb-tile` matches nothing, because `instrument="field"` still renders the deck.

- [ ] **Step 3: Implement**

Add to `app/(hub)/onboarding-instruments.tsx` and route `case "field"` to it:

```tsx
/** Every domain on screen at once. A tap leans toward, a second leans against,
 * a third takes it back — the whole field is visible while they decide. */
function Field({ deck, responses, onAnswer }: InstrumentProps) {
  const answer = (id: string) => responses.find(r => r.id === id);
  const cycle = (prediction: Prediction) => {
    const current = answer(prediction.id)?.direction;
    const direction = current === undefined ? "yes" : current === "yes" ? "no" : "unsure";
    onAnswer({ ...prediction, direction });
  };
  return <div className="onb-tiles">{deck.map(prediction => {
    const current = answer(prediction.id);
    return <div key={prediction.id} className="onb-tile" data-direction={current?.direction}>
      <button type="button" aria-pressed={current !== undefined} onClick={() => cycle(prediction)}>
        <span className="onb-eyebrow">{prediction.category}</span>
        <strong>{prediction.text}</strong>
        <span className="onb-tile-state">{current === undefined ? "Tap to lean" : current.direction === "yes" ? "I see it" : current.direction === "no" ? "I don’t see it" : "Not sure"}</span>
      </button>
      {current && current.direction !== "unsure" && <input type="text" maxLength={NOTE_MAX} value={current.note ?? ""} placeholder="A thought, if you have one" aria-label={`Why: ${prediction.text}`} onChange={e => onAnswer({ ...current, note: e.target.value })} />}
    </div>;
  })}</div>;
}
```

`onAnswer` must upsert rather than append once more than one instrument uses it. In `onboarding-flow.tsx`, change the handler to:

```tsx
onAnswer={response => update(current => { const responses = current.responses.some(r => r.id === response.id) ? current.responses.map(r => r.id === response.id ? response : r) : [...current.responses, response]; return { responses, scene: responses.length === 7 && instrumentFor(current.confidence) === "deck" ? SCENE.strongest : SCENE.deck }; })}
```

The deck still auto-advances at seven; the field, sorter and thesis advance on `Continue`, so the flow must render its `Continue` button whenever the instrument is not the deck. Change the actions condition from `scene !== SCENE.deck` to:

```tsx
          {(scene !== SCENE.deck || instrumentFor(a.confidence) !== "deck") && <button type="button" className="button button-primary" ...>
```

And add a `next()` guard so a field cannot be left half-answered:

```tsx
    if (scene === SCENE.deck && a.responses.length < 7) return setError("Lean on each of the seven possibilities.");
```

- [ ] **Step 4: Add the styles**

Append to `app/(hub)/onboarding.css`:

```css
/* Field: every domain visible while they decide. */
.onb-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); gap: .6rem; }
.onb-tile { display: grid; gap: .45rem; }
.onb-tile > button { display: grid; gap: .45rem; text-align: left; padding: .95rem 1rem; border: 1px solid var(--line); border-radius: 10px; background: var(--card); transition: border-color 140ms ease, background-color 140ms ease; }
.onb-tile > button:hover { background: var(--surface-muted); }
.onb-tile strong { font-size: .82rem; font-weight: 500; line-height: 1.45; letter-spacing: -.01em; }
.onb-tile-state { color: var(--quiet); font-size: .68rem; }
.onb-tile[data-direction="yes"] > button { border-color: var(--onb-accent-line); background: var(--onb-accent-wash); }
.onb-tile[data-direction="yes"] .onb-tile-state { color: var(--onb-accent-deep); }
.onb-tile[data-direction="no"] > button { border-color: rgba(var(--onb-ink-rgb), .35); }
.onb-tile input { width: 100%; padding: .55rem .7rem; border: 1px solid var(--line); border-radius: 8px; background: var(--card); font-size: .75rem; }
@media (prefers-reduced-motion: reduce) { .onb-tile > button { transition: none; } }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. `social-trading.test.tsx` uses `"I know what I believe"` and all-unsure deck paths; confirm its `uncertain()` helper still reaches the dislikes scene.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-instruments.tsx" "app/(hub)/onboarding-instruments.test.tsx" "app/(hub)/onboarding-flow.tsx" "app/(hub)/onboarding.css"
git commit -m "feat: hunches lean on a field instead of swiping a deck"
```

---

### Task 8: The Sorter instrument (some things feel clear)

**Files:**
- Modify: `app/(hub)/onboarding-instruments.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: `app/(hub)/onboarding-instruments.test.tsx`

**Interfaces:**
- Consumes: `DraggableDislike`'s gesture pattern from `onboarding-drag.tsx` as the reference for pointer-owning chips; `InstrumentProps` from Task 6.
- Produces: `Sorter` rendered when `instrument === "sorter"`. Two columns, agree and disagree. The first two statements placed get a "because…" input writing `note`.

- [ ] **Step 1: Write the failing test**

Append to `app/(hub)/onboarding-instruments.test.tsx`:

```tsx
it("sorts statements into two columns and asks the first two placed for a reason", async () => {
  const deck = predictions(2);
  const answered: PredictionResponse[] = [];
  const responses = [{ ...deck[0], direction: "yes" as const }, { ...deck[1], direction: "no" as const }, { ...deck[2], direction: "yes" as const }];
  await act(async () => root.render(<Instruments instrument="sorter" deck={deck} responses={responses} onAnswer={r => answered.push(r)} onUndo={() => {}} />));
  expect(container.querySelectorAll(".onb-column")).toHaveLength(2);
  expect(container.querySelectorAll(".onb-sorter-unplaced .onb-chip")).toHaveLength(4);
  // Only the first two placed are asked why.
  expect(container.querySelectorAll(".onb-column input[type='text']")).toHaveLength(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-instruments.test.tsx`
Expected: FAIL — `.onb-column` matches nothing.

- [ ] **Step 3: Implement**

Add both components below to `app/(hub)/onboarding-instruments.tsx` and route `case "sorter"` to `Sorter`.

`DraggableDislike` in `onboarding-drag.tsx` owns its pointer against a single target. The sorter needs two, so it gets its own chip built on the same pattern — press, capture, track, resolve the target under the pointer on release, and suppress the click that a drag would otherwise fire. Each chip also carries two plain buttons, so the sort never depends on a drag.

```tsx
/** Same gesture contract as DraggableDislike, resolved against two targets:
 * whichever column holds the pointer on release takes the statement. */
function DraggableStatement({ prediction, targets, onPlace }: {
  prediction: Prediction;
  targets: { direction: "yes" | "no"; ref: React.RefObject<HTMLDivElement | null> }[];
  onPlace: (direction: "yes" | "no") => void;
}) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const hit = (x: number, y: number) => targets.find(t => {
    const r = t.ref.current?.getBoundingClientRect();
    return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  function reset() { gesture.current = null; setDragging(false); setPosition({ x: 0, y: 0 }); for (const t of targets) t.ref.current?.classList.remove("is-receiving"); }
  return <div className={`onb-chip${dragging ? " is-dragging" : ""}`} style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
    onPointerDown={event => {
      if (event.button !== 0 || gesture.current || (event.target as HTMLElement).closest("button")) return;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
    }}
    onPointerMove={event => {
      const g = gesture.current; if (!g || g.id !== event.pointerId) return;
      const x = event.clientX - g.x, y = event.clientY - g.y;
      if (Math.hypot(x, y) > 4) g.moved = true;
      setPosition({ x, y });
      const over = hit(event.clientX, event.clientY);
      for (const t of targets) t.ref.current?.classList.toggle("is-receiving", t === over);
    }}
    onPointerUp={event => {
      const g = gesture.current; if (!g || g.id !== event.pointerId) return;
      const over = g.moved ? hit(event.clientX, event.clientY) : undefined;
      reset(); if (over) onPlace(over.direction);
    }}
    onPointerCancel={reset}
    onLostPointerCapture={() => { if (gesture.current) reset(); }}>
    <span className="onb-eyebrow">{prediction.category}</span><strong>{prediction.text}</strong>
    <div>
      <button type="button" onClick={() => onPlace("no")}>I don’t see it</button>
      <button type="button" onClick={() => onPlace("yes")}>I see it</button>
    </div>
  </div>;
}

/** Sorting is the interaction; the reason is the payload. Only the first two
 * placed are asked why, so a clear view gives its argument without the screen
 * turning into seven text boxes. */
function Sorter({ deck, responses, onAnswer }: InstrumentProps) {
  const agree = useRef<HTMLDivElement>(null);
  const disagree = useRef<HTMLDivElement>(null);
  const targets = [{ direction: "yes" as const, ref: agree }, { direction: "no" as const, ref: disagree }];
  const asked = responses.filter(r => r.direction !== "unsure").slice(0, 2).map(r => r.id);
  const unplaced = deck.filter(p => !responses.some(r => r.id === p.id));
  const column = (direction: "yes" | "no", ref: React.RefObject<HTMLDivElement | null>, title: string) =>
    <div ref={ref} className="onb-column" data-direction={direction}>
      <h3>{title}</h3>
      {responses.filter(r => r.direction === direction).map(r => <div key={r.id} className="onb-placed">
        <strong>{r.text}</strong>
        {asked.includes(r.id) && <input type="text" maxLength={NOTE_MAX} value={r.note ?? ""} placeholder="because…" aria-label={`Why: ${r.text}`} onChange={e => onAnswer({ ...r, note: e.target.value })} />}
      </div>)}
    </div>;
  return <div className="onb-sorter">
    {column("no", disagree, "I don’t see it")}
    <div className="onb-sorter-unplaced">{unplaced.map(p =>
      <DraggableStatement key={p.id} prediction={p} targets={targets} onPlace={direction => onAnswer({ ...p, direction })} />)}</div>
    {column("yes", agree, "I see it")}
  </div>;
}
```

- [ ] **Step 4: Add the styles**

Append to `app/(hub)/onboarding.css`:

```css
/* Sorter: two poles, a tray between them. */
.onb-sorter { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr); gap: .75rem; align-items: start; }
.onb-column { display: grid; gap: .5rem; align-content: start; min-height: 9rem; padding: .85rem; border: 1px dashed var(--line); border-radius: 12px; }
.onb-column h3 { color: var(--quiet); font-size: .66rem; font-weight: 500; letter-spacing: .1em; text-transform: uppercase; }
.onb-column[data-direction="yes"] { border-color: var(--onb-accent-line); }
.onb-placed { display: grid; gap: .4rem; padding: .7rem .8rem; border-radius: 9px; background: var(--surface-muted); }
.onb-placed strong { font-size: .76rem; font-weight: 500; line-height: 1.45; }
.onb-placed input { width: 100%; padding: .45rem .6rem; border: 1px solid var(--line); border-radius: 7px; background: var(--card); font-size: .72rem; }
.onb-sorter-unplaced { display: grid; gap: .5rem; align-content: start; }
.onb-chip { display: grid; gap: .5rem; padding: .9rem 1rem; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.onb-chip strong { font-size: .82rem; font-weight: 500; line-height: 1.45; }
.onb-chip div { display: flex; gap: .4rem; }
.onb-chip button { flex: 1; padding: .4rem .5rem; border: 1px solid var(--line); border-radius: 7px; background: var(--card); font-size: .7rem; }
.onb-chip button:last-child { border-color: var(--onb-accent-line); color: var(--onb-accent-deep); }
.onb-chip { cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.onb-chip.is-dragging { cursor: grabbing; z-index: 2; position: relative; box-shadow: 0 18px 40px -22px rgba(var(--onb-ink-rgb), .5); }
.onb-column.is-receiving { border-style: solid; border-color: var(--onb-accent); background: var(--onb-accent-wash); }
@media (max-width: 720px) { .onb-sorter { grid-template-columns: minmax(0, 1fr); } }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-instruments.tsx" "app/(hub)/onboarding-instruments.test.tsx" "app/(hub)/onboarding.css"
git commit -m "feat: a clear view is sorted, and the first two say why"
```

---

### Task 9: The Thesis-first instrument (I know what I believe)

**Files:**
- Modify: `app/(hub)/onboarding-instruments.tsx`
- Modify: `app/(hub)/onboarding-flow.tsx`
- Modify: `app/(hub)/onboarding.css`
- Test: `app/(hub)/onboarding-instruments.test.tsx`

**Interfaces:**
- Consumes: `domainsTouched` from Task 2; `InstrumentProps` from Task 6.
- Produces: `ThesisFirst` rendered when `instrument === "thesis"`, taking two extra props `belief: string` and `onBelief: (value: string) => void`. Domains the belief names light up; the rest are asked in a compact confirm row.

- [ ] **Step 1: Write the failing test**

Append to `app/(hub)/onboarding-instruments.test.tsx`:

```tsx
it("lights the domains a belief names and asks only about the rest", async () => {
  const deck = predictions(3);
  await act(async () => root.render(<Instruments instrument="thesis" deck={deck} responses={[]} belief="Electricity and the grid decide the decade." onBelief={() => {}} onAnswer={() => {}} onUndo={() => {}} />));
  const touched = Array.from(container.querySelectorAll(".onb-domain[data-touched]"));
  expect(touched.map(el => el.getAttribute("data-domain"))).toEqual(["Energy"]);
  // The six it did not name are still asked, so coverage never varies.
  expect(container.querySelectorAll(".onb-domain")).toHaveLength(7);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/onboarding-instruments.test.tsx`
Expected: FAIL — `.onb-domain` matches nothing.

- [ ] **Step 3: Implement**

Add to `app/(hub)/onboarding-instruments.tsx` and route `case "thesis"` to it:

```tsx
/** Someone with strong convictions writes first. The domains their words
 * already covered light up, which they can check at a glance; the ones the
 * matcher missed are simply asked, so it can be under-eager but never
 * wrong-assertive, and coverage stays at seven either way. */
function ThesisFirst({ deck, responses, belief, onBelief, onAnswer }: InstrumentProps & { belief: string; onBelief: (value: string) => void }) {
  const touched = domainsTouched(belief);
  return <div className="onb-thesis">
    <textarea autoFocus maxLength={300} value={belief} placeholder="I believe the next big change will be…" aria-label="Your belief" onChange={e => onBelief(e.target.value)} />
    <div className="onb-domains">{deck.map(prediction => {
      const current = responses.find(r => r.id === prediction.id);
      const named = touched.includes(prediction.category);
      return <div key={prediction.id} className="onb-domain" data-domain={prediction.category} data-touched={named || undefined} data-direction={current?.direction}>
        <span className="onb-eyebrow">{prediction.category}</span>
        {named && !current && <span className="onb-domain-note">You touched on this</span>}
        <strong>{prediction.text}</strong>
        <div>
          <button type="button" aria-pressed={current?.direction === "no"} onClick={() => onAnswer({ ...prediction, direction: "no" })}>No</button>
          <button type="button" aria-pressed={current?.direction === "unsure"} onClick={() => onAnswer({ ...prediction, direction: "unsure" })}>Unsure</button>
          <button type="button" aria-pressed={current?.direction === "yes"} onClick={() => onAnswer({ ...prediction, direction: "yes" })}>Yes</button>
        </div>
      </div>;
    })}</div>
  </div>;
}
```

In `app/(hub)/onboarding-flow.tsx`, pass the two extra props through to `Instruments`:

```tsx
belief={a.ownBelief} onBelief={ownBelief => update({ ownBelief })}
```

and widen `Instruments`'s props to accept them, forwarding only to `ThesisFirst`.

- [ ] **Step 4: Add the styles**

Append to `app/(hub)/onboarding.css`:

```css
/* Thesis first: write, then confirm what the words did not reach. */
.onb-thesis { display: grid; gap: 1.1rem; }
.onb-thesis textarea { width: 100%; min-height: 8rem; padding: 1.1rem 1.2rem; border: 1px solid var(--line); border-radius: 12px; background: var(--card); font-size: 1rem; line-height: 1.6; resize: vertical; }
.onb-thesis textarea::placeholder { color: var(--quiet); }
.onb-domains { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: .55rem; }
.onb-domain { display: grid; gap: .4rem; align-content: start; padding: .85rem .95rem; border: 1px solid var(--line); border-radius: 10px; background: var(--card); transition: border-color 200ms ease, background-color 200ms ease; }
.onb-domain[data-touched] { border-color: var(--onb-accent-line); background: var(--onb-accent-wash); }
.onb-domain-note { color: var(--onb-accent-deep); font-size: .66rem; }
.onb-domain strong { font-size: .76rem; font-weight: 500; line-height: 1.45; }
.onb-domain div { display: flex; gap: .35rem; }
.onb-domain div button { flex: 1; padding: .35rem; border: 1px solid var(--line); border-radius: 6px; background: var(--card); font-size: .68rem; }
.onb-domain div button[aria-pressed="true"] { border-color: var(--onb-accent); background: var(--onb-accent); color: #fff; }
@media (prefers-reduced-motion: reduce) { .onb-domain { transition: none; } }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. `social-trading.test.tsx`'s `foundation()` defaults to `"I know what I believe"`, so its later cases now run through this instrument — confirm they still reach the dislikes scene, and update that helper's confidence argument only if the test's intent genuinely changed.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-instruments.tsx" "app/(hub)/onboarding-instruments.test.tsx" "app/(hub)/onboarding-flow.tsx" "app/(hub)/onboarding.css"
git commit -m "feat: conviction writes first, and the gaps ask themselves"
```

---

### Task 10: The coverage invariant holds for every instrument

**Files:**
- Test: `app/(hub)/onboarding-instruments.test.tsx`

**Interfaces:**
- Consumes: `Instruments`, `Prediction` from Task 6; `instrumentFor`, `predictions`, `CATEGORIES` from `@/lib/socialtrading/onboarding`.
- Produces: nothing. This task exists to hold the plan's central promise in place — confidence picks the instrument, never the coverage — and to prove that changing confidence mid-flow does not discard answers.

- [ ] **Step 1: Write the failing tests**

Append to `app/(hub)/onboarding-instruments.test.tsx`:

```tsx
/** Drives one instrument to completion the way a person would, and returns the
 * responses it produced. Each instrument answers in its own idiom; all of them
 * must land on seven, one per domain. */
async function answerEverything(instrument: "deck" | "field" | "sorter" | "thesis") {
  const deck = predictions(2);
  let responses: PredictionResponse[] = [];
  const onAnswer = (r: PredictionResponse) => {
    responses = responses.some(x => x.id === r.id) ? responses.map(x => x.id === r.id ? r : x) : [...responses, r];
    return act(async () => root.render(<Instruments instrument={instrument} deck={deck} responses={responses} belief="" onBelief={() => {}} onAnswer={onAnswer} onUndo={() => {}} />));
  };
  await act(async () => root.render(<Instruments instrument={instrument} deck={deck} responses={responses} belief="" onBelief={() => {}} onAnswer={onAnswer} onUndo={() => {}} />));
  for (let i = 0; i < 7; i++) {
    const target = instrument === "deck"
      ? container.querySelector(".onb-votes button")!
      : Array.from(container.querySelectorAll(".onb-tile > button, .onb-chip button, .onb-domain div button"))[0];
    expect(target, `${instrument} ran out of controls at answer ${i + 1}`).toBeTruthy();
    await click(target);
  }
  return responses;
}

it("answers all seven domains whichever instrument the confidence chose", async () => {
  for (const instrument of ["deck", "field", "sorter", "thesis"] as const) {
    const responses = await answerEverything(instrument);
    expect(responses, instrument).toHaveLength(7);
    expect(new Set(responses.map(r => r.category)).size, instrument).toBe(7);
    expect([...responses].map(r => r.category).sort(), instrument).toEqual([...CATEGORIES].sort());
  }
});

it("shows an answer already given whichever instrument the confidence moved to", async () => {
  const deck = predictions(2);
  const answered: PredictionResponse[] = [{ ...deck[0], direction: "yes", note: "Already said." }];
  const render = (instrument: "deck" | "field" | "sorter" | "thesis") =>
    act(async () => root.render(<Instruments instrument={instrument} deck={deck} responses={answered} belief="" onBelief={() => {}} onAnswer={() => {}} onUndo={() => {}} />));

  // The deck has moved past the domain that was answered.
  await render("deck");
  expect(container.textContent).toContain(deck[1].text);
  expect(container.querySelector(".onb-prediction h2")!.textContent).not.toBe(deck[0].text);

  // The field shows that tile leaning toward, and keeps the reason typed into it.
  await render("field");
  expect(container.querySelector(".onb-tile[data-direction='yes']")).toBeTruthy();
  expect((container.querySelector(".onb-tile input[type='text']") as HTMLInputElement).value).toBe("Already said.");

  // The sorter has it placed, not sitting in the tray.
  await render("sorter");
  expect(container.querySelector(".onb-column[data-direction='yes']")!.textContent).toContain(deck[0].text);
  expect(container.querySelectorAll(".onb-sorter-unplaced .onb-chip")).toHaveLength(6);

  // The thesis confirm row shows it already answered.
  await render("thesis");
  const domain = container.querySelector(`.onb-domain[data-domain="${deck[0].category}"]`)!;
  expect(domain.querySelector("button[aria-pressed='true']")!.textContent).toBe("Yes");
});
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- app/\(hub\)/onboarding-instruments.test.tsx`
Expected: PASS if Tasks 7–9 are correct. A failure here is a defect in an instrument, not in this test — fix the instrument.

The likely failure is the sorter: `answerEverything` clicks the first `.onb-chip button`, which is `I don’t see it`, and a placed statement leaves the tray, so the next iteration finds the next chip. If the sorter re-orders the tray on each placement, the loop will still terminate but may answer a different domain each time; that is fine, as the assertion is on the set of categories, not their order.

- [ ] **Step 3: Commit**

```bash
npm run typecheck
git add "app/(hub)/onboarding-instruments.test.tsx"
git commit -m "test: coverage never varies with confidence"
```

---

### Task 11: Knowledge calibrates how much the agent volunteers

**Files:**
- Modify: `lib/socialtrading/agents/personality.ts`
- Test: `lib/socialtrading/agents/personality.test.ts`

**Interfaces:**
- Consumes: `InvestorAnswers.knowledge` (0–4, where onboarding writes 0–3).
- Produces: a second knowledge-indexed line in `agentVoice` covering context and proactivity.

- [ ] **Step 1: Write the failing test**

Append to `lib/socialtrading/agents/personality.test.ts`:

```ts
it("volunteers context to a beginner and gets out of an expert's way", () => {
  const beginnerVoice = agentVoice(state({ themes: ["energy"], permission: "notify", investorAnswers: { knowledge: 0, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "" } }));
  expect(beginnerVoice).toContain("Define every term");
  const expertVoice = agentVoice(state({ themes: ["ai"], permission: "automatic", investorAnswers: { knowledge: 3, guidedTest: false, opportunityDrivers: [], esgPriority: null, aiPriority: null, technologies: [], conflictCountries: [], geopoliticalThesis: "", futureVision: "" } }));
  expect(expertVoice).toContain("Assume the context");
  expect(expertVoice).not.toContain("Define every term");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/socialtrading/agents/personality.test.ts`
Expected: FAIL — neither string is present.

- [ ] **Step 3: Implement**

Add to `lib/socialtrading/agents/personality.ts`, beside the existing `DEPTH` map:

```ts
/** DEPTH sets terminology and explanation depth. This sets the other two
 * things the trail scene calibrates: how much context arrives unasked, and how
 * far ahead the agent walks. */
const REACH: Record<number, string> = {
  0: "Define every term the first time you use it, and offer the background before they have to ask for it. Lead them one step at a time.",
  1: "Give a sentence of background with anything unfamiliar, and suggest the next thing worth looking at.",
  2: "Surface context only where it changes the read, and let them set the pace.",
  3: "Assume the context and go straight to the judgement. Volunteer only what they could not already have known.",
  4: "Assume the context and go straight to the judgement. Volunteer only what they could not already have known.",
};
```

In `agentVoice`, directly after the `DEPTH` line in the `lines` array, add:

```ts
    a.knowledge === null ? REACH[2] : REACH[a.knowledge],
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/socialtrading/agents/personality.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add lib/socialtrading/agents/personality.ts lib/socialtrading/agents/personality.test.ts
git commit -m "feat: the agent volunteers as much context as the trail asked for"
```

---

### Task 12: The profile card reacts from the first drag

**Files:**
- Modify: `app/(hub)/onboarding-flow.tsx`
- Modify: `app/(hub)/profile-card.tsx`
- Test: `app/(hub)/social-trading.test.tsx`

**Interfaces:**
- Consumes: `ProfileDetail` (already in `profile-card.tsx`, animating only on a changed `value`); `CONFIDENCE`, `EXPERIENCE` from `@/lib/socialtrading/onboarding`.
- Produces: two `ProfileDetail` rows — "Conviction" from `onboarding.confidence` and "Voice" from `investorAnswers.knowledge` — rendered only once their value exists.

- [ ] **Step 1: Write the failing test**

Append to `app/(hub)/social-trading.test.tsx`:

```tsx
it("writes the card as the foundations are answered, one row at a time", async () => {
  await render();
  expect(container.textContent).not.toContain("Conviction");
  await click("I have a few hunches");
  expect(container.textContent).toContain("Conviction");
  expect(container.textContent).toContain("I have a few hunches");
  await click("Continue");
  await click("I know the basics");
  expect(container.textContent).toContain("Voice");
  expect(container.textContent).toContain("Explains as it goes");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/\(hub\)/social-trading.test.tsx`
Expected: FAIL — "Conviction" is not in the document.

- [ ] **Step 3: Implement**

In `app/(hub)/profile-card.tsx`, add beside the other derived values in `ProfileCard`:

```tsx
  const onboarding = profile.investorAnswers.onboarding;
  const conviction = onboarding?.confidence === null || onboarding?.confidence === undefined ? "" : CONFIDENCE[onboarding.confidence];
  const voice = profile.investorAnswers.knowledge === null ? "" : ["Explains from first principles", "Explains as it goes", "Gets to the point", "Goes straight to the judgement"][Math.min(3, profile.investorAnswers.knowledge)];
```

Render them with the existing `ProfileDetail`, which already animates only the row whose `value` changed:

```tsx
      {conviction && <ProfileDetail label="Conviction" value={conviction}>{conviction}</ProfileDetail>}
      {voice && <ProfileDetail label="Voice" value={voice}>{voice}</ProfileDetail>}
```

Import `CONFIDENCE` from `@/lib/socialtrading/onboarding`.

In `app/(hub)/onboarding-flow.tsx`, the `preview` object must carry the live onboarding answers so the card sees them. It already spreads `...profile`, which includes `investorAnswers.onboarding` — confirm no explicit `investorAnswers` override drops them, and add one if it does.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add "app/(hub)/profile-card.tsx" "app/(hub)/onboarding-flow.tsx" "app/(hub)/social-trading.test.tsx"
git commit -m "feat: the card is written while the foundations are answered"
```

---

### Task 13: Verify the whole flow in the browser

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Start the dev server**

Use the preview tooling with `.claude/launch.json`, not a raw `npm run dev` in a shell.

- [ ] **Step 2: Walk each confidence path**

Open `/?onboarding=tree`. For each of the four confidence stops, complete onboarding end to end and confirm:
- the lens field consolidates 20 → 12 → 7 → 4 as the drag moves right;
- the trail's layers appear only behind the traveler;
- the instrument matches the stop (deck, field, sorter, thesis);
- all seven domains are answered before `Continue` is accepted;
- the profile card gains its Conviction row on the first drag and its Voice row on the second.

- [ ] **Step 3: Check the console and reduced motion**

Read console messages for errors. Then emulate `prefers-reduced-motion: reduce` and confirm the scenes still change state — blur and clipping remain, transitions do not.

- [ ] **Step 4: Screenshot each foundation scene at all four stops**

Capture the evidence and report it. If anything above fails, fix it under `superpowers:systematic-debugging` and commit the fix before closing the plan.
