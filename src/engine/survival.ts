import type { Player } from '../data/player';
import { clamp, normalCdf } from './math';

/**
 * Survival probability: the chance a player is still on the board at some
 * future overall pick.
 *
 * Model: the pick where a player actually comes off the board is treated as
 * Normal(adp, sigma). Given that the player is still available at the current
 * pick, the probability they survive to a later pick is the conditional tail:
 *
 *   P(X >= target | X >= current) = P(X >= target) / P(X >= current)
 *
 * where X is the player's exit pick. Sigma comes from the data when provided,
 * otherwise it grows with ADP: early picks are predictable, late picks are
 * chaotic.
 */

export function defaultAdpStdDev(adp: number): number {
  return clamp(2 + adp * 0.14, 2.5, 28);
}

export function survivalProbability(
  player: Player,
  currentPick: number,
  targetPick: number,
): number {
  if (targetPick <= currentPick) return 1;
  let sigma = player.adpStdDev && player.adpStdDev > 0 ? player.adpStdDev : defaultAdpStdDev(player.adp);
  // A player still available well past ADP has been faded by this room: the
  // ADP was too optimistic, so widen the distribution rather than letting the
  // truncated-normal hazard explode in the tail (falling players keep falling).
  const overshoot = currentPick - player.adp;
  if (overshoot > 0) sigma = Math.max(sigma, overshoot * 0.9);
  // P(X >= p) with a continuity-style offset: surviving TO pick p means the
  // player was not taken at picks < p.
  const tail = (p: number) => 1 - normalCdf(p - 0.5, player.adp, sigma);
  const num = tail(targetPick);
  const den = tail(currentPick);
  if (den <= 1e-9) {
    // The model says this player should already be gone; being available is
    // itself surprising, so fall back to the unconditional tail shape.
    return clamp(num, 0.02, 1);
  }
  return clamp(num / den, 0, 1);
}
