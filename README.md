# FootBud

A fantasy football draft companion that runs alongside a live draft and
answers one question after every pick:

> Given the current draft state, who should I take now, and what am I
> risking by waiting?

FootBud is not a static ranking site. A deterministic decision engine
recalculates every recommendation from the live draft state: who is gone,
what your roster needs, how scarce each position is getting, and how likely
each player is to survive until your next turn.

## Quick start

```bash
npm install
npm run dev       # open the printed URL
```

The app ships with sample 2026 preseason projections so it works
immediately. For a real draft, import your own projections CSV on the setup
screen (columns: `name, team, position, projected_points, adp`; optional:
`adp_std_dev, tier, bye_week, injury_status, player_id`).

```bash
npm test          # engine test suite (vitest)
npm run typecheck # strict TypeScript
npm run build     # production build
```

## What it does today (MVP: manual draft companion)

- Configure the league: 4-20 teams, snake or linear, your slot, scoring
  preset, full roster slot counts (QB/RB/WR/TE/FLEX/SUPERFLEX/K/DST/bench).
- Import projections/ADP from CSV, or use the bundled sample data.
- Pick a strategy preset (Quantitative 1.01 default, Balanced Value, Hero
  RB, Zero RB, Robust RB, Late-Round QB) and edit weights, position
  priorities, and rules in the advanced panel.
- Run the draft by entering every selection; the pool, rosters, and all
  recommendations update after each pick. Undo restores everything.
- Drafts auto-save to localStorage and can be resumed.

Every recommendation shows plain-language reasons plus:

- **Best pick and alternatives** with score, VOR, tier, and survival odds.
- **Will he make it back?** Survival probability bars for the players you
  care about, computed against your actual next pick.
- **Two-pick plan** for draft turns: the best combination of a pick now and
  a position to target with your following pick.

## How the engine works

Each available player gets a score built from independently computed,
independently testable factors:

| Factor | Meaning |
| --- | --- |
| Projection | Projected production, normalized within position |
| VOR | Projected points minus the replacement-level player at the position, where replacement level derives from league size, starters, flex shares, and bench appetite |
| Scarcity | The player's VOR minus the expected best VOR remaining at the position at your next pick (tier drop-off cost of waiting) |
| Survival urgency | Valuable players unlikely to survive to your next pick score higher; survival is a truncated normal over ADP, conditioned on the player still being available, widened for players the room is fading |
| Roster need | Open starter slots, then flex, then bench depth appetite |
| Value vs ADP | Players falling below their market price |

A strategy applies weights, position priorities, and rules (wait on QB
until round N unless exceptional value, cap kickers at one, boost RB in a
round window) on top of the quantitative core. Strategies are data, not
code: the future AI strategy builder translates language into this same
structure and never invents its own math.

## Project layout

```
src/config     league and roster configuration (zod schemas)
src/data       player model, CSV import, sample projections
src/draft      draft order, draft state, rosters, undo, save/load
src/engine     VOR, tiers, scarcity, survival, roster need, recommendation
src/strategy   strategy schema, presets
src/ai         AI provider abstraction, Anthropic implementation, prompts
src/ui         React components (setup, draft screen, board, panels)
test           vitest suite for order, state, engine, import, sample data
```

The engine consumes `DraftState`, never UI state, and is fully testable
without rendering anything.

## AI features

FootBud has an AI layer powered by the Claude API. Add your own Anthropic
API key in the AI section of the setup screen; it is stored only in your
browser and sent only to the Claude API.

- **Build a strategy with AI**: a short guided interview. It asks what you
  value most, how long you are willing to wait at each position, which
  players you think are undervalued or overvalued, and where you draft
  from. It then produces a structured strategy and shows you its
  interpretation before you apply it.
- **Upload a strategy**: drop in a .txt, .md, or .pdf strategy write-up
  and it gets extracted into the same structured format, with the
  interpretation shown for confirmation.
- **Adjust with AI**: plain-language edits to the active strategy ("no QB
  before round 6", "be more aggressive on WR early") with a shown diff of
  exactly what changed.
- **Ask AI during the draft**: a panel that answers questions like "why
  this pick over the highest-ranked player" or "what if I wait on TE".
  It receives the engine's actual numbers (scores, VOR, survival
  probabilities, tier info, wait costs, your strategy) and explains them.

The AI never replaces the math. Language in, structured strategy out; the
quantitative engine makes every recommendation, and player reads you give
the AI (targets and avoids) become score nudges, not overrides.

## Roadmap

1. ~~Manual draft companion with quantitative engine~~ (done)
2. ~~AI strategy builder, conversational editing, in-draft assistant~~ (done)
3. Deeper multi-pick decision trees with pruning
4. Live draft integrations (ESPN and others) behind a `DraftSource`
   adapter, so the engine never cares where picks come from

## Notes

- Sample projections are plausible preseason numbers for trying the app,
  not a rankings product. Import your own data for a real draft.
- Survival probabilities are estimates from ADP; they will be wrong about
  individual picks and useful in aggregate. That is the point of the
  take-now versus wait framing.
