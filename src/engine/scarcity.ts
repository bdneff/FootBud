import type { Position } from '../config/league';
import type { Player } from '../data/player';
import type { ReplacementBaseline } from './replacement';
import { vor } from './replacement';
import { survivalProbability } from './survival';

/**
 * Positional scarcity: what does waiting cost?
 *
 * For each position we estimate the expected VOR of the best player still
 * available at a future pick, using each player's survival probability. The
 * best-available expectation walks players in descending VOR order:
 *
 *   E[best] = sum_i VOR_i * P(i survives) * prod_{j better than i} P(j gone)
 */

export function expectedBestVorAtPick(
  position: Position,
  available: Player[],
  baselines: Map<Position, ReplacementBaseline>,
  currentPick: number,
  targetPick: number,
): number {
  const candidates = available
    .filter((p) => p.position === position)
    .map((p) => ({ v: vor(p, baselines), s: survivalProbability(p, currentPick, targetPick) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 25); // beyond this depth the contribution is negligible

  let expected = 0;
  let allBetterGone = 1;
  for (const c of candidates) {
    expected += c.v * c.s * allBetterGone;
    allBetterGone *= 1 - c.s;
    if (allBetterGone < 1e-6) break;
  }
  return expected;
}

/**
 * Drop-off for one player: their VOR minus the expected best VOR remaining at
 * the position at the user's next pick. Positive and large = taking this
 * player now beats waiting; near zero or negative = a comparable player will
 * likely still be there.
 */
export function dropOff(
  player: Player,
  available: Player[],
  baselines: Map<Position, ReplacementBaseline>,
  currentPick: number,
  nextUserPick: number | null,
): number {
  const playerVor = vor(player, baselines);
  if (nextUserPick === null) return 0;
  const availableWithoutPlayer = available.filter((p) => p.playerId !== player.playerId);
  const expectedBest = expectedBestVorAtPick(
    player.position,
    availableWithoutPlayer,
    baselines,
    currentPick,
    nextUserPick,
  );
  return playerVor - expectedBest;
}
