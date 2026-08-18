import type { Position } from '../config/league';
import type { Player } from '../data/player';
import type { DraftState } from '../draft/state';
import { opponentPicksBetween } from '../draft/order';
import type { Recommendation } from './recommend';
import { vor } from './replacement';
import { expectedBestVorAtPick } from './scarcity';
import { survivalProbability } from './survival';

/**
 * A compact decision tree for the user's current choice: for each realistic
 * pick now, what does the next user pick probably look like?
 *
 *   Draft WR A
 *   ├── RB B survives (34%) -> take RB B
 *   └── RB B gone (66%) -> best RB expected: RB C tier
 *
 * Branches are pruned hard: a handful of root candidates (position-diverse),
 * one target and one fallback each. Values are VOR so branches compare on
 * the same scale as the rest of the engine.
 */

export interface TreeLeaf {
  outcome: 'survives' | 'gone';
  probability: number;
  /** The player taken in this outcome; null when it is an expected-value pool. */
  player: Player | null;
  /** VOR of the leaf's pick (expected VOR for the gone-fallback). */
  value: number;
  fallbackPosition: Position | null;
}

export interface TreeBranch {
  pickNow: Player;
  pickNowVor: number;
  /** P(this root player is still available at the deciding pick). */
  rootAvailability: number;
  /** The follow-up player this branch plans around at the next user pick. */
  target: Player | null;
  leaves: TreeLeaf[];
  /** Availability-weighted: P(root reaches you) x (root VOLS + follow-up EV). */
  expectedValue: number;
}

export interface DecisionTree {
  /** Overall pick number the tree decides. */
  decidingPick: number;
  /** The user pick the follow-up leaves refer to. */
  followUpPick: number | null;
  branches: TreeBranch[];
}

const MAX_BRANCHES = 4;
const MAX_PER_POSITION = 2;

/** Root candidates: top scored, at most two per position, K/DST excluded. */
function rootCandidates(rec: Recommendation): Player[] {
  const out: Player[] = [];
  const perPos = new Map<Position, number>();
  for (const s of rec.scored) {
    const pos = s.player.position;
    if (pos === 'K' || pos === 'DST') continue;
    if ((perPos.get(pos) ?? 0) >= MAX_PER_POSITION) continue;
    out.push(s.player);
    perPos.set(pos, (perPos.get(pos) ?? 0) + 1);
    if (out.length >= MAX_BRANCHES) break;
  }
  return out;
}

export function buildDecisionTree(
  state: DraftState,
  rec: Recommendation,
): DecisionTree | null {
  if (state.complete || state.currentPick === null) return null;
  const userOnClock = state.slotOnClock === state.config.userDraftSlot;
  const decidingPick = userOnClock ? state.currentPick : state.nextUserPick;
  // In both cases the follow-up is the user pick after the one being decided.
  const displayFollowUp = rec.userPickAfterNext;
  if (decidingPick === null) return null;

  const current = state.currentPick;
  const available = state.availablePlayers;
  const baselines = rec.baselines;
  // Availability math advances only when opponents pick: at a snake turn the
  // follow-up is guaranteed and every survival below becomes 1.
  const compress = (target: number) =>
    current + opponentPicksBetween(state.config, state.config.userDraftSlot, current, target);
  const cDeciding = compress(decidingPick);
  const followUpPick = displayFollowUp === null ? null : compress(displayFollowUp);

  const branches: TreeBranch[] = rootCandidates(rec).map((pickNow) => {
    const pickNowVor = vor(pickNow, baselines);
    // Between picks the root itself may never reach the deciding pick; the
    // whole branch is worth its expected value, not its face value.
    const rootAvailability = userOnClock ? 1 : survivalProbability(pickNow, current, cDeciding);
    if (followUpPick === null) {
      return {
        pickNow,
        pickNowVor,
        rootAvailability,
        target: null,
        leaves: [],
        expectedValue: rootAvailability * pickNowVor,
      };
    }

    const remaining = available.filter((p) => p.playerId !== pickNow.playerId);

    // The target: the most valuable remaining player with a realistic chance
    // of reaching the follow-up pick. Preferring raw value (with a survival
    // floor) keeps the leaves coherent: getting the target must always beat
    // missing him, or he is not worth planning around.
    const candidates = remaining
      .filter((p) => p.position !== 'K' && p.position !== 'DST')
      .map((p) => ({ p, v: vor(p, baselines) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 12)
      .map(({ p, v }) => ({
        p,
        v,
        // Conditional on the draft reaching the deciding pick with the board
        // as modeled: survival measured from there to the follow-up.
        surv: survivalProbability(p, cDeciding, followUpPick),
      }));
    const target =
      candidates.find((t) => t.surv >= 0.15) ??
      [...candidates].sort((a, b) => b.v * b.surv - a.v * a.surv)[0];

    if (!target) {
      return {
        pickNow,
        pickNowVor,
        rootAvailability,
        target: null,
        leaves: [],
        expectedValue: rootAvailability * pickNowVor,
      };
    }

    // Fallback if the target is gone: the best expected VOR at the follow-up
    // pick across positions, with the target excluded from his own position.
    const withoutTarget = remaining.filter((p) => p.playerId !== target.p.playerId);
    let fallbackValue = -Infinity;
    let fallbackPosition: Position | null = null;
    for (const position of ['QB', 'RB', 'WR', 'TE'] as Position[]) {
      const expected = expectedBestVorAtPick(
        position,
        withoutTarget,
        baselines,
        current,
        followUpPick,
      );
      if (expected > fallbackValue) {
        fallbackValue = expected;
        fallbackPosition = position;
      }
    }
    if (!Number.isFinite(fallbackValue)) fallbackValue = 0;

    const leaves: TreeLeaf[] = [
      {
        outcome: 'survives',
        probability: target.surv,
        player: target.p,
        value: target.v,
        fallbackPosition: null,
      },
      {
        outcome: 'gone',
        probability: 1 - target.surv,
        player: null,
        value: fallbackValue,
        fallbackPosition,
      },
    ];
    const expectedValue =
      rootAvailability *
      (pickNowVor + target.surv * target.v + (1 - target.surv) * fallbackValue);
    return { pickNow, pickNowVor, rootAvailability, target: target.p, leaves, expectedValue };
  });

  // A root with almost no chance of reaching you is not a decision.
  const viable = branches.filter((b) => b.rootAvailability >= 0.05);
  const kept = viable.length > 0 ? viable : branches;
  kept.sort((a, b) => b.expectedValue - a.expectedValue);
  // The display field carries the real pick number; the compressed horizon
  // was only for the availability math above.
  return { decidingPick, followUpPick: displayFollowUp, branches: kept };
}
