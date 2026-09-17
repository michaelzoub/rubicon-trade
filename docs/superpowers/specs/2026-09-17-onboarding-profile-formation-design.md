# Onboarding as profile formation

Onboarding stops being a questionnaire and becomes the act of revealing a
worldview. Two foundational drags carry it: how confident someone is in their
beliefs, and how familiar investing feels. Everything downstream is shaped by
those two answers, and a profile card builds itself beside the user the whole
time.

Core rule: every screen has one central interaction, and that interaction is
self-explanatory through affordance, motion and feedback rather than through a
sentence explaining it. Text is what remains after the interaction has failed
to say something.

## Decisions

- **Coverage is invariant.** All four confidence paths write the same seven
  `PredictionResponse` entries, one per domain. Confidence changes the
  instrument, never the coverage, so profiles stay comparable and the agent
  always receives a full map. This preserves the existing rule in
  `lib/socialtrading/onboarding.ts:6`.
- **Focus scene reveals the trade being made.** The blur hides a field of
  future-fragments that consolidates as it sharpens: many and vague, or few
  and certain. The interaction previews the branch it is choosing.
- **Trail scene assembles an instrument.** The environment growing richer is a
  price line gaining candles, axes, volume and annotations, clipped to the
  traveler's position, so dragging forward draws it into existence.
- **The stop buttons stay.** The existing `.onb-choices` grid keeps its
  current styling. Only the redundant `01 / 04` readout is removed.
- **Knowledge calibrates four things,** not one: terminology, explanation
  depth, how much context is surfaced unasked, and how proactively the agent
  guides.

## The foundation scenes

Both scenes share a structure: a tall stage, a rail beneath it, and the
existing four-button grid.

`onboarding-flow.tsx` renders one shared `.onb-heading` for all eight scenes
from the `TITLES` and `NOTES` arrays. For the two foundation scenes only, that
header collapses to the eyebrow and a short title, with the `NOTES` lead and
the `.onb-hint` suppressed; the other six scenes keep the header they have
today. The `.onb-state` readout is removed from the foundation scenes
entirely, because the pressed button in the grid already names the stop.

The rail is the `SmoothRange` native `<input type="range">` already in
`onboarding-drag.tsx`. Arrow keys, Home/End and `aria-valuetext` keep working
unchanged. Four tick marks sit on the rail as click targets that jump to a
stop. The stage is draggable too, through the existing `useDrag`, so the rail
is affordance and accessibility rather than a second way to answer. The button
grid remains the explicit path for anyone who would rather just pick, and
keeps its `01` mono numerals, labels, `EXPERIENCE_NOTES` subtitles and
accent-wash pressed state exactly as they are today.

`StopRail` moves into `onboarding-drag.tsx` alongside `useDrag`,
`SmoothRange` and `DraggableDislike`. `FoundationScale` is retired; its two
halves become the two scene files below.

### Focus — `app/(hub)/onboarding-focus.tsx`

Behind the blur is a field of roughly twenty short future-fragments, drawn
from the same seven domains the next screen will ask about. Dragging right
does not only sharpen. It consolidates.

| Stop | Fragments | Blur | Type |
| --- | --- | --- | --- |
| I'm here to explore | ~20, drifting | heavy, illegible | small |
| I have a few hunches | ~12 | soft, words readable | small |
| Some things feel clear | ~7 | crisp | larger |
| I know what I believe | 4, still | sharp | largest |

Fragments that do not survive a stop fade out; survivors grow and settle. The
user watches many possibilities become few convictions, which is exactly what
the branch about to happen will hand them. No copy has to explain it.

The lens is a real optic rather than a ring drawn over a blur. Two stacked
copies of the field are rendered: the lower one blurred and faded by the
global focus, the upper one sharp and clipped to
`circle() at var(--lens-x)`. Whatever falls under the ring resolves ahead of
the global focus, so moving the lens finds things.

Fragments are grouped into four depth bands, and the blur filter is applied to
the band wrapper rather than to each fragment. That is eight blurred nodes on
the page instead of forty.

### Trail — `app/(hub)/onboarding-trail.tsx`

The trail is a price line, and the environment becoming richer is the
instrument assembling.

| Stop | What exists |
| --- | --- |
| Unknown ground | a bare dashed path on white, and nothing else |
| I know the basics | the path goes solid ink; a baseline with two soft ticks; a faint area fill |
| I am comfortable exploring | candles along the line, a y-axis with real values, a volume band |
| Experienced | a moving average, a dashed compared series, two annotation pins, a numeric readout |

Every layer is clipped to the traveler's x-position. Ahead of the traveler is
bare dashed path; behind them the instrument exists. One `--position` variable
drives every clip, so dragging forward draws the instrument into being. The
drag is causal rather than a state switch, and it honestly previews how much
Rubicon will show this person later.

### Reduced motion

Under `prefers-reduced-motion: reduce`, drift and transitions are removed.
Blur and clipping remain, because they are state rather than motion.

## The branch — `app/(hub)/onboarding-instruments.tsx`

Confidence selects which instrument renders at `SCENE.deck`. All four produce
seven responses.

| Confidence | Instrument | Interaction | Captured |
| --- | --- | --- | --- |
| Explore | Deck (exists today) | seven cards, swipe right, left or down | direction |
| Hunches | Field | all seven tiles at once; tap to lean toward, tap again to lean against; any tile takes a one-line thought | direction, optional note |
| Clear | Sorter | drag each statement into agree or disagree; the first two placed ask for a short "because…" | direction, why for two |
| Conviction | Thesis first | a freeform surface opens immediately; domains light up beneath as the words touch them; then a fast confirm pass over only the untouched domains | freeform, confirm |

The Conviction path's detection reuses `suggestedThemes()` and is deliberately
one-directional. A domain the words touched is shown as touched, which the
user can verify at a glance. A domain the matcher misses is simply asked. It
can be under-eager; it cannot be wrong-assertive.

Because all four instruments produce the same shape, changing confidence
mid-flow re-renders the instrument without discarding answers. `sceneOrder`
and `resolveScene` are untouched — `SCENE.deck` resolves to one of four
components.

The swipe deck moves out of `onboarding-flow.tsx` into this file along with
the three new instruments. `onboarding-flow.tsx` is 186 dense lines today and
the deck's pointer handling is the largest thing in it; moving all four
instruments together keeps the flow file about orchestration.

## Model — `lib/socialtrading/onboarding.ts`

- `PredictionResponse` gains `note?: string`, capped at 140 characters and
  validated in `readOnboarding` alongside the existing `confidence` and
  `years` bounds.
- `instrumentFor(confidence)` returns `"deck" | "field" | "sorter" |
  "thesis"`.
- `onboardingThesis` folds notes in as the reasoning behind each strongest
  view, so the "why" a Clear or Hunches user gave reaches the agent.

## Voice — `lib/socialtrading/agents/personality.ts`

`agentVoice` already spends knowledge on `DEPTH[a.knowledge]`, which covers
terminology and explanation depth. A second knowledge-indexed line is added
for the two the brief names and the voice currently lacks: how much context is
surfaced unasked, and how proactively the agent guides.

Onboarding writes knowledge 0–3, so `DEPTH[4]` remains reachable only from
legacy and API-created profiles (`profile.ts:106`, `app/api/trade/agents/route.ts:25`).
That is pre-existing and stays as it is.

## The living panel — `app/(hub)/profile-card.tsx`

`ProfileCard` sits empty until scene 3 today. It reacts from the first drag
instead: the focus scene fills its conviction line as the lens sharpens, the
trail scene updates its voice line as the instrument assembles, and the avatar
keeps deriving its eyes from knowledge as it already does in
`lib/socialtrading/avatar.ts:38`.

Only the row that changed animates, with a brief accent flash. Never a
wholesale re-render — the card should feel like it is being written, not
redrawn.

## Tests

- **Coverage invariant.** Every instrument yields seven responses, one per
  domain, for every confidence level.
- **`instrumentFor`** maps each confidence stop to its instrument.
- **Note validation.** `readOnboarding` keeps a valid note, drops an
  over-length or non-string one, and survives a note on a response it
  otherwise rejects.
- **Confidence change preserves answers.** Moving between instruments after
  answering does not discard `responses`.
- **Drag geometry.** The existing `onboarding-drag.test.ts` cases for
  `clamp`, `intervalAt`, `intervalCenter` and `valueAt` continue to pass
  against the retained helpers.
