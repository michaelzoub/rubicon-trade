# Explore, Buy, Activity, Profile: consumer-first redesign

Date: 2026-09-15. Scope: the four hub views and the shared primitives they need. No API or schema changes. Provider seams stay as they are.

## Assumptions (non-interactive session)

1. The brief is the design direction. Where it leaves a choice open, this spec picks one and says so.
2. Typography, palette, and the white surface stay exactly as the hub has them today. The redesign spends its boldness on light and motion, not on new fonts or colours.
3. The Rubicon light-blue glow is the single signature: one traveling light that marks "where you are" in the tab bar (already there), inside the new lens control, around the Buy module, along the Activity thread, and behind the Profile identity.
4. GSAP is the only motion library. The confetti burst from rubicon-app (framer-motion) is ported to GSAP with the same fifteen pieces, the same paths, and Rubicon blue in place of its brand blue.
5. Data shape and copy limits are unchanged: every existing plan-limit message, follow cap, and error still shows, but never as a settings panel.

## Shared primitives

- `app/_components/motion.tsx` registers `ScrollTrigger` beside `useGSAP` and exports it.
- `app/_components/celebration.tsx`: `useCelebration()` returns `{ celebrate(origin?), Celebration }`. `Celebration` renders a fixed, pointer-transparent portal at the origin with fifteen GSAP-driven pieces; under reduced motion it renders nothing. One burst per call; the node removes itself after the timeline ends.
- `app/(hub)/_hub/lens.tsx`: `Lens` is a segmented control for exploring, not filtering. Each item has an icon and a hue; a light (`hub-lens-light`) stretches toward the chosen item and settles, in the same two-beat move as the tab bar mark. Hover nudges the icon; the active item is tinted in its own hue. Full keyboard support through `role="tablist"`.
- `app/(hub)/_hub/hub-consumer.css`: the redesigned sections, loaded after `hub.css`.

## Explore

Opens as a hero: a constellation of six cards (four stocks, two tokens, the highest-scored from the user's stock and crypto picks) floating over two blue washes. Each card carries logo, symbol, price, sparkline, and its relevance label, sits at its own depth, breathes on a slow loop, and shifts with the pointer by its depth. Cards are links to their detail page.

On scroll, a scrubbed ScrollTrigger timeline draws the constellation into the centre, scales it down, blurs it and fades it out while the lens and grid rise into place. Reduced motion shows the constellation static and skips the scrub.

Lenses (one unified control, stocks and crypto together): **For you** (stock and crypto merged, sorted by score), **Themes**, **New**, **Moving**. Search lives only under For you and searches both kinds. Themes shows six theme "orbs" in their own colours with the learned/explicit note underneath; choosing one lights it and loads the grid.

Discovery cards (`DiscoveryCard`) gain depth: a tilt that follows the pointer, a blue ring on hover, the logo lifting. Behaviour (Watch, Ask agent, Not for me, dismiss persistence) is unchanged.

## Buy

One centred column (max 36rem). The module is the page: a white card with a ring of light and two washes behind it. Three moments, animated between:

1. **Choose**: search plus "Available to buy" tiles (`hub-buy-result`, kept for tests) with logo, price, and chain.
2. **Amount**: the chosen asset as a compact card with logo; a large centred dollar input; presets that pop when chosen; one primary button "Buy $X of SYMBOL" with a blue glow.
3. **Sign / done**: the existing trade card appears under the module (`hub-swap-result`). When the trade's status becomes `confirmed`, confetti bursts from the card and a line reads "It's yours." with the amount and symbol.

The wallet and permissions aside becomes one quiet disclosure under the module (`hub-wallet-profile` kept), showing the monogram, name, and "Wallet & permissions". "More ways to buy" stays as the toggle to the swap form. In-progress and settled lists follow as sections.

## Activity

"Your world, lately." A pulse strip at the top says, in words, what happened recently (learned, updates, trades waiting). Filters use `Lens`. Each day is a section with a sticky day label. Every event is a card with a medallion for its kind (sparkle for learning, badge for profile, bot for agent, arrows for trade). A trade waiting on the user carries the priority light and a "Needs you" badge. The thread on the left is a gradient line; items rise in as they enter view. Details stay behind "Details".

## Profile

Identity first: the signed-in person's name is the H1, the agent badge beside it, the wallet address as a small chip when a wallet is linked, and one line about what the agent has learned.

Facets, not settings (`hub-facet` cards, each with a heading, a one-line summary in words, and its editor revealed on "Adjust"):

- **Your point of view**: the thesis as a quote; adjust reveals the textarea and the character count.
- **What you care about**: theme cards plus the two chip lists (watching, care about) and the muted list. Limit pills and hints stay.
- **How your agent works with you**: the three modes as a lit trio; a "comfort zone" of three amounts appears only when the mode needs it.
- **What your agent remembers**: inferred themes and assets as glowing meters with "Forget this".
- **Plan & wallets**: one line for the plan (`hub-plan-summary` kept) and the wallets section behind a disclosure.

"Tell your agent" starters stay above the facets. Saving is a floating pill that slides in when anything is dirty, with Discard beside it.

## Testing

- `hub.test.tsx`: the profile test asserts facets instead of `details[name=profile-settings]`; Buy and Trade tests keep passing unchanged.
- New `explore-view.test.tsx`: For you merges stock and crypto, the constellation renders up to six cards, Themes shows orbs and loads a theme.
- New `activity-view.test.tsx`: groups by day, the pending trade is flagged "Needs you", filters narrow the feed.
- New `celebration.test.tsx`: the success line appears when a trade turns confirmed; under reduced motion no confetti node renders.
- `/preview?view=explore|trade|activity|profile` shows every page.
