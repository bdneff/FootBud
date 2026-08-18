import type { LeagueConfig, Position } from '../config/league';
import { totalPicks } from '../config/league';
import type { Player, PlayerPool } from '../data/player';
import { buildPool } from '../data/player';
import { nextPickForSlot, pickInRound, roundOfPick, slotOnClock } from './order';

export interface DraftPick {
  overall: number;
  round: number;
  pickInRound: number;
  /** Draft slot (1..numberOfTeams) that made the pick. */
  slot: number;
  playerId: string;
}

export interface TeamRoster {
  slot: number;
  players: Player[];
  countsByPosition: Record<Position, number>;
}

/**
 * The single source of truth for a draft in progress. The engine consumes
 * this object, never UI state. Picks are the only mutable history; everything
 * else is derived deterministically so undo is just "drop the last pick".
 */
export interface DraftState {
  config: LeagueConfig;
  /** Every player loaded for this draft, drafted or not. */
  pool: PlayerPool;
  /** Picks made so far, in overall order. */
  picks: DraftPick[];
  // Derived (recomputed on every transition):
  /** Overall number of the pick currently on the clock; null when draft complete. */
  currentPick: number | null;
  currentRound: number | null;
  /** Slot on the clock; null when draft complete. */
  slotOnClock: number | null;
  availablePlayers: Player[];
  rosters: TeamRoster[];
  /** Overall number of the user's next pick (>= currentPick), null if none remain. */
  nextUserPick: number | null;
  /** Picks other teams make before the user is on the clock again. 0 when the user is up. */
  picksUntilUserPick: number | null;
  /** The user's pick after nextUserPick; used for two-pick planning. */
  userPickAfterNext: number | null;
  complete: boolean;
}

function emptyCounts(): Record<Position, number> {
  return { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
}

function derive(config: LeagueConfig, pool: PlayerPool, picks: DraftPick[]): DraftState {
  const total = totalPicks(config);
  const current = picks.length + 1;
  const complete = picks.length >= total;

  const drafted = new Set(picks.map((p) => p.playerId));
  const availablePlayers = [...pool.values()]
    .filter((p) => !drafted.has(p.playerId))
    .sort((a, b) => a.adp - b.adp);

  const rosters: TeamRoster[] = [];
  for (let slot = 1; slot <= config.numberOfTeams; slot++) {
    rosters.push({ slot, players: [], countsByPosition: emptyCounts() });
  }
  for (const pick of picks) {
    const player = pool.get(pick.playerId);
    if (!player) throw new Error(`Pick references unknown player ${pick.playerId}`);
    const roster = rosters[pick.slot - 1];
    if (!roster) throw new Error(`Pick references invalid slot ${pick.slot}`);
    roster.players.push(player);
    roster.countsByPosition[player.position] += 1;
  }

  const nextUserPick = complete ? null : nextPickForSlot(config, config.userDraftSlot, current);
  const userPickAfterNext =
    nextUserPick === null ? null : nextPickForSlot(config, config.userDraftSlot, nextUserPick + 1);

  return {
    config,
    pool,
    picks,
    currentPick: complete ? null : current,
    currentRound: complete ? null : roundOfPick(current, config.numberOfTeams),
    slotOnClock: complete ? null : slotOnClock(current, config.numberOfTeams, config.draftType),
    availablePlayers,
    rosters,
    nextUserPick,
    picksUntilUserPick: complete || nextUserPick === null ? null : nextUserPick - current,
    userPickAfterNext,
    complete,
  };
}

export function createDraft(config: LeagueConfig, players: Player[]): DraftState {
  return derive(config, buildPool(players), []);
}

/** Record the on-the-clock team selecting a player. Throws on invalid picks. */
export function applyPick(state: DraftState, playerId: string): DraftState {
  if (state.complete || state.currentPick === null) {
    throw new Error('Draft is complete');
  }
  const player = state.pool.get(playerId);
  if (!player) throw new Error(`Unknown player: ${playerId}`);
  if (state.picks.some((p) => p.playerId === playerId)) {
    throw new Error(`${player.name} is already drafted`);
  }
  const overall = state.currentPick;
  const pick: DraftPick = {
    overall,
    round: roundOfPick(overall, state.config.numberOfTeams),
    pickInRound: pickInRound(overall, state.config.numberOfTeams),
    slot: slotOnClock(overall, state.config.numberOfTeams, state.config.draftType),
    playerId,
  };
  return derive(state.config, state.pool, [...state.picks, pick]);
}

/** Undo the most recent pick. All derived state is rebuilt from history. */
export function undoPick(state: DraftState): DraftState {
  if (state.picks.length === 0) return state;
  return derive(state.config, state.pool, state.picks.slice(0, -1));
}

export function userRoster(state: DraftState): TeamRoster {
  const roster = state.rosters[state.config.userDraftSlot - 1];
  if (!roster) throw new Error('Invalid user slot');
  return roster;
}

/** Serializable form for save/load. */
export interface SavedDraft {
  version: 1;
  savedAt: string;
  config: LeagueConfig;
  players: Player[];
  picks: DraftPick[];
}

export function serializeDraft(state: DraftState, savedAt: string): SavedDraft {
  return {
    version: 1,
    savedAt,
    config: state.config,
    players: [...state.pool.values()],
    picks: state.picks,
  };
}

export function restoreDraft(saved: SavedDraft): DraftState {
  return derive(saved.config, buildPool(saved.players), saved.picks);
}
