# Manage agents: consumer-first redesign

Date: 2026-09-15. Scope: the `/agents` hub view and the small provider seams it needs. No API or schema changes.

## Assumptions (non-interactive session)

1. Thesis, interests, mode, and limits keep their editing home on the Profile page, which already covers them. The agents page shows none of it.
2. Names and purposes stay system-generated (`agents/naming.ts`). The page never offers a name or purpose field.
3. Creating an agent still needs a place to start. It is one ghost card at the end of the grid that opens the existing guided flow. Plan caps still apply.
4. Removing an agent stays possible, but only as a quiet final line inside the reveal dialog, with a confirm step, and only when more than one agent exists.
5. "Analyzing" means the agent is enabled for scheduled runs. "Resting" means it is not. The words "running", "paused", "cron", and "job" never appear.

## Page

`AgentsView` renders a heading, then `hub-agent-grid`: one `AgentCard` per agent plus a `NewAgentCard`. Clicking a card opens `AgentReveal`. Choosing the ghost card swaps the grid for the existing `ProfileFlow` creation canvas with a cancel.

### AgentCard

- The card is one `<button>`. It carries CSS custom properties from `badgePalette(themes)`: `--agent-light`, `--agent-color`, `--agent-dark`, `--agent-rgb`.
- White surface, two radial washes in the theme light color, a faint theme-tinted ring, and layered soft shadows. The badge avatar sits top-left; name and inferred purpose below; a status line at the foot; when known, the assets it watches as small chips.
- Analyzing: status dot breathes, the gradient drifts slowly. Resting: the card is desaturated and dimmed, and a single inline "Wake up" control appears. Wake up is disabled with a tooltip when the plan's awake cap is reached.
- Hover or focus: translateY(-4px), deeper shadow, brighter wash. Reduced motion removes animation and keeps the hover state change to shadow only.

### AgentReveal

A `<dialog>` using `.rubicon-hover-surface` (black, 10px radius) sized to about 22rem, centered, with a dimmed backdrop. Content, in order:

1. Badge, name, inferred purpose, status line ("Analyzing" or "Resting").
2. "Paying attention to": interest chips from the agent's profile, preferences, and learned interests. Empty: "Still getting to know you."
3. "Recently noticed": up to three recent run summaries in plain words with relative time. Loading: "Looking back…". Empty: "Nothing yet. Ask it to take a look."
4. Actions: "Take a look now" (manual run), "Talk to it" (switch agent, go Home), and "Let it rest" / "Wake up".
5. Foot (agents.length > 1): "Say goodbye" → confirm inline ("Say goodbye to {name}? Its history goes with it." / "Yes, goodbye" / "Keep it").

Escape or backdrop closes it. Focus returns to the card.

## Provider seams

- `inspectAgent(id): Promise<{ state: HubState | null; runs: RunRecord[] }>` loads another agent's state and runs without switching.
- `runNow(id?)` runs the given agent, defaulting to the active one; state updates only when it matches the active agent.

## Removal

Delete `Section`, `Switch`, `Watchlist`, `RecentRuns`, the rail, the TOC, and the settings form from `agents-view.tsx`, and their CSS block from `hub.css`. The `agent` state action stays because the Profile page and tests use it.

## Testing

- Existing `agents-manage.test.tsx` and `agents.test.tsx` keep passing (provider behaviour unchanged).
- New `agents-view.test.tsx`: renders cards for each agent with Analyzing/Resting labels, no settings vocabulary, opens the dialog on click, shows recent summaries, and "Wake up" calls `setAgentEnabled`.
- `/preview?view=agents` shows the new page.
