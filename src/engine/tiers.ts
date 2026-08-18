import type { Position } from '../config/league';
import type { Player } from '../data/player';
import { playersByPosition } from '../data/player';

/**
 * Tier assignment. If the projection source provides tiers we respect them.
 * Otherwise we detect tiers from projected-point gaps: a new tier starts
 * wherever the drop between consecutive players is clearly larger than the
 * typical drop at that position.
 */
export function assignTiers(allPlayers: Player[]): Map<string, number> {
  const tiers = new Map<string, number>();
  const byPos = playersByPosition(allPlayers);
  for (const list of byPos.values()) {
    if (list.length === 0) continue;
    if (list.every((p) => p.tier !== undefined)) {
      for (const p of list) tiers.set(p.playerId, p.tier!);
      continue;
    }
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      gaps.push(list[i - 1]!.projectedPoints - list[i]!.projectedPoints);
    }
    const meanGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    const threshold = Math.max(meanGap * 1.75, 8);
    let tier = 1;
    tiers.set(list[0]!.playerId, tier);
    for (let i = 1; i < list.length; i++) {
      if (list[i - 1]!.projectedPoints - list[i]!.projectedPoints >= threshold) tier++;
      tiers.set(list[i]!.playerId, tier);
    }
  }
  return tiers;
}

/**
 * How many players remain in this player's tier (including the player) among
 * the available pool. A player who is the last of a tier is more urgent.
 */
export function remainingInTier(
  player: Player,
  available: Player[],
  tiers: Map<string, number>,
): number {
  const tier = tiers.get(player.playerId);
  if (tier === undefined) return Number.POSITIVE_INFINITY;
  return available.filter(
    (p) => p.position === player.position && tiers.get(p.playerId) === tier,
  ).length;
}

export function tierOf(player: Player, tiers: Map<string, number>): number | undefined {
  return tiers.get(player.playerId);
}

export type TiersByPosition = Map<Position, Map<number, Player[]>>;
