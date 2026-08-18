import { z } from 'zod';
import { PLAYER_POSITIONS, type Position } from '../config/league';

export const PlayerSchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1),
  team: z.string().min(1),
  position: z.enum(PLAYER_POSITIONS),
  /** Full-season projected fantasy points in the league's scoring format. */
  projectedPoints: z.number().min(0),
  /** Average draft position (overall pick number). */
  adp: z.number().min(0.1),
  /** Std dev of ADP; when absent the engine derives one from ADP. */
  adpStdDev: z.number().min(0).optional(),
  /** Overall rank from the projection source (optional; engine can derive). */
  rank: z.number().int().min(1).optional(),
  positionalRank: z.number().int().min(1).optional(),
  /** Tier from the source; when absent the engine detects tiers from point gaps. */
  tier: z.number().int().min(1).optional(),
  injuryStatus: z.string().optional(),
  byeWeek: z.number().int().min(1).max(18).optional(),
});
export type Player = z.infer<typeof PlayerSchema>;

export type PlayerPool = ReadonlyMap<string, Player>;

export function buildPool(players: Player[]): Map<string, Player> {
  const pool = new Map<string, Player>();
  for (const p of players) {
    if (pool.has(p.playerId)) {
      throw new Error(`Duplicate playerId: ${p.playerId}`);
    }
    pool.set(p.playerId, p);
  }
  return pool;
}

export function playersByPosition(players: Iterable<Player>): Map<Position, Player[]> {
  const byPos = new Map<Position, Player[]>();
  for (const pos of PLAYER_POSITIONS) byPos.set(pos, []);
  for (const p of players) byPos.get(p.position)!.push(p);
  for (const list of byPos.values()) {
    list.sort((a, b) => b.projectedPoints - a.projectedPoints);
  }
  return byPos;
}
