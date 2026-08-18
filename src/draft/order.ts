import type { DraftType, LeagueConfig } from '../config/league';
import { totalPicks } from '../config/league';

/**
 * Draft ordering. Picks and rounds are 1-indexed. Teams are identified by
 * draft slot (1..numberOfTeams).
 */

export function roundOfPick(overall: number, teams: number): number {
  return Math.ceil(overall / teams);
}

export function pickInRound(overall: number, teams: number): number {
  return ((overall - 1) % teams) + 1;
}

/** Which draft slot is on the clock for a given overall pick. */
export function slotOnClock(overall: number, teams: number, draftType: DraftType): number {
  const round = roundOfPick(overall, teams);
  const idx = pickInRound(overall, teams);
  if (draftType === 'linear' || round % 2 === 1) return idx;
  return teams - idx + 1; // even snake rounds reverse
}

/** All overall pick numbers belonging to a slot, in order. */
export function picksForSlot(config: LeagueConfig, slot: number): number[] {
  const total = totalPicks(config);
  const picks: number[] = [];
  for (let overall = 1; overall <= total; overall++) {
    if (slotOnClock(overall, config.numberOfTeams, config.draftType) === slot) {
      picks.push(overall);
    }
  }
  return picks;
}

/**
 * The slot's next pick at or after `fromOverall`, or null if the slot has no
 * remaining picks.
 */
export function nextPickForSlot(
  config: LeagueConfig,
  slot: number,
  fromOverall: number,
): number | null {
  const total = totalPicks(config);
  for (let overall = Math.max(1, fromOverall); overall <= total; overall++) {
    if (slotOnClock(overall, config.numberOfTeams, config.draftType) === slot) {
      return overall;
    }
  }
  return null;
}

/**
 * How many picks in [from, to) belong to OPPONENTS of the given slot. Only
 * opponent picks can take a player away from you, so availability math must
 * advance by this count, not by raw pick distance. At a snake turn (you own
 * picks 24 and 25) the answer is zero: everyone survives to your next pick.
 */
export function opponentPicksBetween(
  config: LeagueConfig,
  slot: number,
  from: number,
  to: number,
): number {
  let count = 0;
  for (let overall = Math.max(1, from); overall < to; overall++) {
    if (slotOnClock(overall, config.numberOfTeams, config.draftType) !== slot) count++;
  }
  return count;
}
