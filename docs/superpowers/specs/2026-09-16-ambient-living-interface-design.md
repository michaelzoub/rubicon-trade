# Ambient, living interface

Rubicon stops being pages full of your data and becomes a world that reacts to
you. Home is your conversation, Explore is your market world, Memory is your
past self, Profile is your identity, and the agent moves between all four.

Core rule: information appears when it becomes relevant instead of permanently
occupying screen space. No new tabs, cards, explanatory copy, or conventional
SaaS navigation is added to solve a problem.

## Decisions

- **Reveal model.** An inline gloss beside the hovered object carries the
  detail; the agent turns toward the object without travelling. Two channels,
  so detail is instant and presence is felt, and the agent never chases the
  cursor.
- **Memory form.** One living belief graph, scrubbed by dragging the canvas.
- **Explore geography.** Themes own fixed bearings; distance is thesis
  relevance; scale and opacity are agent confidence.
- **Agent cadence.** Continuous slow wander, with courtesy while composing.
- **Command menu.** Kept, restyled away from launcher chrome.
- **Pending trades.** Carried by the agent's "wanting attention" state, not by
  a page.

## Foundation

### Motion spine — `app/_components/motion.ts`

Registers `Flip`, `Draggable`, `InertiaPlugin`, `MotionPathPlugin`,
`MorphSVGPlugin`, `CustomEase` and `Observer` alongside the existing
`ScrollTrigger`. Adds two `CustomEase` curves: `creature` (accelerates out of
rest, settles without overshoot) and `breath` (asymmetric rise and fall).

These are load-bearing. Flip is what lets Explore reorganize rather than
re-render. Draggable with InertiaPlugin is what makes Memory's time tactile.
MotionPath is what makes the agent travel like a creature rather than lerp.

### Procedural identity colour — `lib/socialtrading/identity-palette.ts`

`badgePalette()` already blends theme colours by weight. This extends it into a
token set applied once on `.hub-layout`: `--id-accent`, `--id-accent-soft`,
`--id-accent-deep`, `--id-wash`.

Chroma scales with identity depth. A new account's accent is near-neutral; a
developed identity's is fully saturated, so colour *is* the progression. Both
lightness and chroma are clamped into a fixed band, so no mix of themes can
break the light Rubicon base.

Profile's arbitrary green is removed by adopting these tokens, not by
restyling.

### Reveal primitive — `app/(hub)/_hub/gloss.tsx`

A `useGloss()` hook plus one portal-rendered layer. An object declares what it
reveals; it never declares chrome.

- 90ms intent delay, then fade and slide in beside the object, flipping side to
  stay inside the viewport. 120ms in, 90ms out.
- Dispatches `rubicon:attend` with the element rect so the agent turns.
- Focus triggers it identically to hover, and the surface is linked with
  `aria-describedby`. This is the accessibility answer to an interface built on
  hover.
- Content is derived, never invented: belief from `convictionsOf(state)` theme
  match, confidence from `state.inferred`, relationship from `relevance()`,
  history from `state.events` touching the asset. With no real connection it
  says so rather than filling space.

### Agent entity — `app/(hub)/_hub/ambient-agent.tsx`

**Form.** `<AgentFace>` is extracted from `app/(hub)/profile-avatar.tsx` so the
badge and the creature render the same seeded identity — same face shape, eyes
and mouth — from one source. The creature is that face at ~44px inside the hex
silhouette, with pattern and theme motifs dropped at small size. MorphSVG
morphs mouth and eye paths between expressions.

**Autonomy.** A perpetual wander loop replaces the pointer magnet. It picks a
weighted region of interest, travels along a quadratic MotionPath over 6-14s
banking into the turn, dwells 4-10s, and picks again. A continuous breath runs
underneath. Regions are elements marked `data-agent-region`; weight rises for
what just became relevant and decays. Positions resolve into the gutter beside
content with a collision check, so the agent never lands on text.

**Attention without travel.** Hovering a glossed object does not summon it. It
rotates to face the object, offsets its pupils toward it, and warms its glow.

**Six states**, each expressed through trajectory, posture, glow, face and
proximity together:

| State | Trajectory | Posture and face | Glow | Proximity |
| --- | --- | --- | --- | --- |
| idle | slow wander | deep breath, half-lidded | dim, slow | far |
| observing | stops, turns | eyes track content | steady | holds distance |
| thinking | tight orbit in place | eyes down, mouth flat | pulsing inward | unchanged |
| discovering | quick rise, moves toward it | eyes wide, mouth open | bright flare | approaches |
| wanting attention | approaches your last focus | slow repeated tilt, bob | warm, insistent | close |
| interacting | settles beside the composer | steady, eyes on you | full, calm | closest |

These replace the previous eight labels: listening and acting become
interacting, researching becomes thinking, noticed becomes discovering, waiting
becomes wanting attention, reflecting becomes observing, and assembling is an
animation rather than a state.

A trade awaiting approval drives "wanting attention". Nothing waiting puts
nothing on screen.

The agent persists across navigation and keeps travelling through the route
transition rather than resetting.

**Courtesy.** While the composer has focus, wander speed drops and the agent
holds a minimum distance from the input. `prefers-reduced-motion` removes
travel and breath entirely, leaving state expressed by face and glow.

## Surfaces

### Home

`<ThesisView compact />` comes off Home; three stacked sections become one. The
page is the conversation with generous whitespace. Empty, it is the composer
plus at most three openers derived from the person's own convictions.

The thesis moves into the gloss. Agent messages, asset symbols inside messages,
and discovery chips are all glossed. Hovering an asset reveals the belief it
connects to, its confidence, and when the person last acted on it. Hovering an
agent message reveals which conviction drove it.

The quiet opportunities strip loses its heading and becomes glossed objects.
`/thesis` is reached by acting on a gloss rather than from a nav item.

### Explore

Removed copy: the `Explore` eyebrow, "The market, through your eyes.", its
subcopy, `YOUR MARKET GRAVITY`, the distance/depth legend, the
`FOLLOW A CONNECTION` panel, the footer sentence, and the "Want more like this?"
note.

Fixed bearings, permanently: energy N, tech 60°, ai 120°, crypto 180°,
healthcare 240°, consumer 300°. An asset sits on the resultant bearing of its
themes. Distance is `1 - relevance()` across a 14%-46% band, replacing the
barely legible 30%-41%. Scale and opacity are agent confidence.

Positions move from CSS `left`/`top` to GSAP transforms, which is what Flip
requires and the reason the current version cannot animate reorganization.

- **Entrance.** Objects arrive from beyond the edge along their own bearing,
  staggered by relevance, so the most relevant arrive first and nearest.
- **Reorganization.** `Flip.from()` on lens, search and theme changes. The same
  objects travel; departures shrink outward along their bearing and arrivals
  come in along theirs.
- **Theme focus.** The field rotates so the chosen bearing swings to top and
  the camera pushes in; off-theme objects recede in scale and opacity instead
  of vanishing.
- **Hover.** The object rises, its line to centre brightens, same-bearing
  neighbours dim.
- **Depth.** Continuous parallax drift per object, amplitude inverse to
  relevance.

The collapsed full list stays as the complete record.

### Memory

`ActivityRecords` and `MemoryView` collapse into one canvas.

Convictions are bodies, radius by strength and chroma from the identity
palette. Shared themes draw edges. A belief first appearing while sharing a
theme with an existing one is drawn as a branch on a stem rather than a peer.
Decisions and discoveries from `state.events` hang as satellites off the belief
they match.

Time is the canvas: `Draggable` with `InertiaPlugin` and `Observer` so drag,
wheel and trackpad all scrub with momentum and settle on a frame. No slider. A
thin tick index at the foot is position feedback, not a control.

Six verbs, each a real diff between consecutive `MemoryFrame`s:

- appearing — scales from zero with a bloom
- strengthening — radius grows, chroma deepens, edges thicken
- fading — shrinks and desaturates toward grey
- branching — splits onto a stem
- contradicted — strength drops sharply while a theme sibling rises; the edge
  between them severs and both recoil
- connecting — satellites draw in on a line

Removed: five eyebrows, the `Lens` filter row, `TradeActivityChart`, the pulse
beads, the day-grouped timeline, and "Your world, lately."

Kept but relocated: the chronological record is real data people need. It
becomes a plain list behind a quiet "everything, in order" disclosure at the
foot, which doubles as the screen-reader equivalent of the graph.

History honestly starts at the first recorded change, capped at 120 frames,
snapshotted only on real change. The existing empty-state language about not
reconstructing past beliefs is kept.

### Profile

Green is replaced by `--id-*` tokens. The `hub-facet` and "Adjust" pattern is
settings-shaped; it becomes a constellation of what the agent knows across
knowledge, interests, convictions, behaviours, discoveries, progression and
understanding. Each is a body sized by how much the agent knows and coloured by
confidence. Dim regions are the game — the gaps are visible. Hover reveals
through the gloss; clicking opens the existing editors unchanged.

`identityDepth`, `identityStage` and `identityStats` already exist and drive
palette chroma globally, so the whole product saturates as the agent learns
about the person. That is the progression: not badges, the world gaining
colour. The large `ProfileAvatar` here is the same identity as the creature.

### Navigation

The command menu is kept and restyled: the `⌘ K` badge and the
"↑ ↓ to move · Enter to open · Esc to return" footer are removed, destinations
and search stay, reskinned to the world language.

The profile object runs a discovery animation on first hover only, persisted in
`localStorage`: a staggered ~1.2s GSAP reveal drawing a border and label on
Profile, Credits, Wallet and Sign out. Afterwards, quiet persistent
affordances — hairline separators and a per-row chevron — keep it learned
without re-explaining it.

## Out of scope

Buy panel, asset detail, agents view, plans, swap form, onboarding, purchase
dialog, and all server and lib logic except the two new lib files.

## Testing

The suite is green at 228 tests before this work and must be green after.
`activity-view.test.tsx` and `explore-view.test.tsx` are rewritten against the
new behaviour rather than deleted. New units cover the identity palette
derivation, the gloss content derivation, the agent's state selection, and the
Memory frame diff that produces the six verbs. Motion itself is not asserted
frame by frame; the tests cover what the person can observe — content, roles,
labels and state attributes — with `prefers-reduced-motion` honoured.
