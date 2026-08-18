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
 * Replacement level per position.
 *
 * The replacement player at a position is the best player expected to be
 * freely available on waivers, i.e. ranked just past the number of players
 * at that position that league-wide rosters will absorb. That count depends
 * on league size, dedicated starters, flex allocation, and a bench share.
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

/** Fraction of bench slots spent on each position, roughly league-typical. */
const BENCH_SHARE: Record<Position, number> = {
  QB: 0.1,
  RB: 0.38,
  WR: 0.38,
  TE: 0.1,
  K: 0.02,
  DST: 0.02,
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
  perTeam += r.BENCH * BENCH_SHARE[position];
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

/** Value over replacement for one player given precomputed baselines. */
export function vor(player: Player, baselines: Map<Position, ReplacementBaseline>): number {
  const base = baselines.get(player.position);
  return player.projectedPoints - (base?.replacementPoints ?? 0);
}
