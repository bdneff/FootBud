import {
  FLEX_ELIGIBLE,
  SUPERFLEX_ELIGIBLE,
  type LeagueConfig,
  type Position,
  PLAYER_POSITIONS,
} from '../config/league';
import type { Player } from '../data/player';
import { playersByPosition } from '../data/player';

/**
 * Replacement level per position: Value Over Last Starter (VOLS).
 *
 * The baseline at a position is the last STARTING-quality player: ranked
 * just past the number of starters the league fields there (dedicated slots
 * plus this position's share of flex/superflex). Bench demand is
 * deliberately excluded; counting it pushed the baseline several rounds too
 * deep and inflated the positions with the steepest tails (RB especially),
 * which over-recommended RBs relative to market.
 */

export interface ReplacementBaseline {
  position: Position;
  /** How many players at this position we expect leagues to roster as relevant. */
  demandCount: number;
  /** Projected points of the replacement-level player. */
  replacementPoints: number;
  /** Name of the player at the baseline, for debugging views. */
  replacementPlayerName: string | null;
}

/**
 * Share of FLEX slots consumed by each eligible position. RB and WR dominate
 * flex usage in practice; TE rarely occupies it.
 */
const FLEX_SHARE: Record<string, number> = { RB: 0.45, WR: 0.45, TE: 0.1 };
/** Superflex is nearly always used on a QB when the league allows it. */
const SUPERFLEX_SHARE: Record<string, number> = { QB: 0.85, RB: 0.06, WR: 0.06, TE: 0.03 };

/**
 * Historical calibration of projected vs realized positional separation
 * (Fantasy Football Analytics, preseason projections 2014-2025): a projected
 * VOLS gap shrinks by roughly this slope in realized scoring. QB and TE
 * gaps exaggerate the most. K/DST have no published slope; they get a
 * conservative value, and it barely matters at their draft cost.
 */
export const CALIBRATION_SLOPE: Record<Position, number> = {
  QB: 0.67,
  RB: 0.79,
  WR: 0.85,
  TE: 0.72,
  K: 0.6,
  DST: 0.6,
};

export function demandCount(config: LeagueConfig, position: Position): number {
  const r = config.roster;
  let perTeam = r[position] as number;
  if (FLEX_ELIGIBLE.includes(position)) {
    perTeam += r.FLEX * (FLEX_SHARE[position] ?? 0);
  }
  if (SUPERFLEX_ELIGIBLE.includes(position)) {
    perTeam += r.SUPERFLEX * (SUPERFLEX_SHARE[position] ?? 0);
  }
  return Math.max(1, Math.round(perTeam * config.numberOfTeams));
}

/**
 * Compute replacement baselines from the FULL player pool (drafted players
 * included: a drafted player still occupies a roster spot league-wide, so the
 * baseline should not drift upward as the draft progresses).
 */
export function replacementBaselines(
  config: LeagueConfig,
  allPlayers: Player[],
): Map<Position, ReplacementBaseline> {
  const byPos = playersByPosition(allPlayers);
  const out = new Map<Position, ReplacementBaseline>();
  for (const position of PLAYER_POSITIONS) {
    const list = byPos.get(position) ?? [];
    const demand = demandCount(config, position);
    const replacementPlayer = list[Math.min(demand, Math.max(0, list.length - 1))] ?? null;
    out.set(position, {
      position,
      demandCount: demand,
      replacementPoints: replacementPlayer?.projectedPoints ?? 0,
      replacementPlayerName: replacementPlayer?.name ?? null,
    });
  }
  return out;
}

/**
 * Calibrated Value Over Last Starter for one player: the projected gap to
 * the last starter at the position, shrunk by the position's historical
 * projection-vs-reality slope so exaggerated projected cliffs (QB and TE
 * especially) are not treated as certain.
 */
export function vor(player: Player, baselines: Map<Position, ReplacementBaseline>): number {
  const base = baselines.get(player.position);
  const raw = player.projectedPoints - (base?.replacementPoints ?? 0);
  return raw * CALIBRATION_SLOPE[player.position];
}

/** Uncalibrated VOLS, for display and debugging views. */
export function rawVols(player: Player, baselines: Map<Position, ReplacementBaseline>): number {
  const base = baselines.get(player.position);
  return player.projectedPoints - (base?.replacementPoints ?? 0);
}
