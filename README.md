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
immediately. For a real draft, load player data on the setup screen:

- **Sleeper**: live projections and ADP from Sleeper's open API, matched
  to your scoring setting.
- **ESPN**: a real public endpoint, but ESPN usually blocks browser apps
  from reading it (no CORS). FootBud tries and explains the failure; export
  a CSV from ESPN if it is blocked for you.
- **Yahoo**: needs OAuth through a server FootBud does not have yet; the
  button says so and points you at CSV export.
- **Aggregate (all)**: averages projections and ADP across every source
  that responds.
- **Upload your own CSV** (columns: `name, team, position,
  projected_points, adp`; optional: `adp_std_dev, tier, bye_week,
  injury_status, player_id`).

All of this sits behind a `ProjectionSource` adapter interface
(`src/data/sources/`), so new providers plug in without touching the
engine.

```bash
npm test          # engine test suite (vitest)
npm run typecheck # strict TypeScript
npm run build     # production build
```

## What it does today (MVP: manual draft companion)

- Configure the league: 4-20 teams, snake or linear, your slot, scoring
  preset, full roster slot counts (QB/RB/WR/TE/FLEX/SUPERFLEX/K/DST/bench).
- Import projections/ADP from CSV, or use the bundled sample data.
- Pick a strategy preset (Probabilistic VOLS 1.01 default, Quantitative
  1.01, Balanced Value, Hero RB, Zero RB, Robust RB, Late-Round QB) and edit weights, position
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
| VOLS | Calibrated Value Over Last Starter: projected points minus the last starting-quality player at the position (starters plus flex share, never bench), shrunk by each position's historical projection-vs-reality slope (QB 0.67, RB 0.79, WR 0.85, TE 0.72) so exaggerated projected cliffs are not treated as certain |
| Scarcity | The player's VOR minus the expected best VOR remaining at the position at your next pick (tier drop-off cost of waiting) |
| Survival urgency | Valuable players unlikely to survive to your next pick score higher; survival is a truncated normal over ADP, conditioned on the player still being available, widened for players the room is fading |
| Roster need | Open starter slots, then flex, then bench depth appetite |
| Value vs ADP | Players falling below their market price |
| Reach discipline | Taking a player far ahead of his market ADP is penalized: value alone does not justify a two-round reach when a comparable board usually offers him later |

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

## Live draft sync

Picks can flow in automatically during a real draft. Everything sits
behind a live-draft adapter (`src/draft/sources/`); the engine never knows
where picks come from.

- **Sleeper** (native): enter your Sleeper username or paste the draft
  URL. FootBud reads the draft's own settings (teams, snake/linear,
  roster slots, scoring, your slot), configures the league to match, and
  polls the public draft API every few seconds. Picks are matched to your
  projections by Sleeper player id or name; platform-side corrections are
  absorbed because every poll rebuilds from the authoritative pick list.
  Traded picks keep their real owner on the board and rosters.
- **ESPN** (companion extension, experimental): ESPN has no public draft
  API, so `extension/` contains a small browser extension that reads the
  pick feed from the ESPN draft room tab you already have open and relays
  it to FootBud. See `extension/README.md` for install and status.
- While synced, manual drafting and undo lock (the platform is the source
  of truth); pause, resume, and disconnect from the draft header. Players
  drafted that your projections do not know become zero-point placeholders
  so the board and rosters stay accurate.

## Roadmap

1. ~~Manual draft companion with quantitative engine~~ (done)
2. ~~AI strategy builder, conversational editing, in-draft assistant~~ (done)
3. ~~Decision tree view with pruned two-pick branches~~ (done; deeper
   3-pick lookahead is a future refinement)
4. ~~Live draft sync: Sleeper native, ESPN via companion extension~~
   (done; Yahoo still needs a server)

## Notes

- Sample projections are plausible preseason numbers for trying the app,
  not a rankings product. Import your own data for a real draft.
- Survival probabilities are estimates from ADP; they will be wrong about
  individual picks and useful in aggregate. That is the point of the
  take-now versus wait framing.
