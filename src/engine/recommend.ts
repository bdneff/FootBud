import { PLAYER_POSITIONS, type Position } from '../config/league';
import type { Player } from '../data/player';
import type { DraftState } from '../draft/state';
import { userRoster } from '../draft/state';
import { opponentPicksBetween } from '../draft/order';
import type { DraftStrategy } from '../strategy/types';
import { AVOID_MULTIPLIER, PRIORITY_MULTIPLIER, TARGET_MULTIPLIER } from '../strategy/types';
import { resolvePlayerNotes } from '../strategy/playerMatch';
import { clamp, normalize } from './math';
import { replacementBaselines, vor, type ReplacementBaseline } from './replacement';
import { rosterNeed } from './rosterNeed';
import { expectedBestVorAtPick, dropOff } from './scarcity';
import { survivalProbability } from './survival';
import { assignTiers, remainingInTier } from './tiers';

export interface ComponentBreakdown {
  projection: number;
  vor: number;
  scarcity: number;
  survival: number;
  rosterNeed: number;
  upside: number;
}

export interface ScoredPlayer {
  player: Player;
  /** Final 0-100 recommendation score after strategy adjustments. */
  score: number;
  /** Normalized 0..1 component values before weighting. */
  components: ComponentBreakdown;
  vorValue: number;
  dropOffValue: number;
  /** P(available at the user's next pick). 1 when no next pick exists. */
  survivalToNextPick: number;
  /** P(available at the pick being advised); 1 when the user is on the clock. */
  availabilityAtYourPick: number;
  tier: number | undefined;
  remainingInTier: number;
  reasons: string[];
  cautions: string[];
}

export interface WaitAnalysis {
  position: Position;
  bestNow: Player | null;
  bestNowVor: number;
  expectedBestVorAtNextPick: number;
  /** VOR expected to be lost by waiting one turn at this position. */
  costOfWaiting: number;
}

export interface PairOption {
  /** Candidate for the current/next user pick. */
  now: ScoredPlayer;
  /** Best position to target with the following pick. */
  thenPosition: Position;
  /** Most likely best player there, for display. */
  thenLikelyPlayer: Player | null;
  expectedThenVor: number;
  combinedValue: number;
}

export interface Recommendation {
  best: ScoredPlayer | null;
  alternatives: ScoredPlayer[];
  /** All scored candidates, descending score. */
  scored: ScoredPlayer[];
  /** Survival outlook for the most relevant players ("Will he make it back?"). */
  survivalBoard: { player: Player; probability: number }[];
  waitByPosition: WaitAnalysis[];
  pairOptions: PairOption[];
  baselines: Map<Position, ReplacementBaseline>;
  nextUserPick: number | null;
  userPickAfterNext: number | null;
}

/** Candidates worth scoring: near the front of the board or high VOR. */
function candidateSet(
  available: Player[],
  baselines: Map<Position, ReplacementBaseline>,
): Player[] {
  const byAdp = [...available].sort((a, b) => a.adp - b.adp).slice(0, 60);
  const byVor = [...available].sort((a, b) => vor(b, baselines) - vor(a, baselines)).slice(0, 60);
  const seen = new Set<string>();
  const out: Player[] = [];
  for (const p of [...byAdp, ...byVor]) {
    if (!seen.has(p.playerId)) {
      seen.add(p.playerId);
      out.push(p);
    }
  }
  return out;
}

export function recommend(state: DraftState, strategy: DraftStrategy): Recommendation {
  const allPlayers = [...state.pool.values()];
  const baselines = replacementBaselines(state.config, allPlayers);
  const tiers = assignTiers(allPlayers);
  const available = state.availablePlayers;
  const current = state.currentPick ?? Number.MAX_SAFE_INTEGER;
  const nextUserPick = state.nextUserPick;
  const userPickAfterNext = state.userPickAfterNext;
  const me = userRoster(state);
  const round = state.currentRound ?? 99;

  // The engine always advises the user's own next pick (evalPick). When the
  // user is on the clock that IS the current pick; between picks everything
  // must be scored for the pick they will actually make, not the opponent's
  // pick on the clock — otherwise the panel plans around players who will be
  // long gone. Availability math runs on opponent-compressed pick counts (at
  // a snake turn zero opponents pick in between, so everyone survives).
  const userOnClock = state.slotOnClock === state.config.userDraftSlot;
  const evalPick = nextUserPick ?? current;
  const followUpPick = userPickAfterNext;
  const compress = (target: number) =>
    current + opponentPicksBetween(state.config, state.config.userDraftSlot, current, target);
  const cEval = compress(evalPick);
  const cFollow = followUpPick === null ? null : compress(followUpPick);
  /** Opponent picks between the advised pick and the one after it. */
  const oppEvalToFollow = cFollow === null ? 0 : cFollow - cEval;
  const displayHorizon = userOnClock ? followUpPick : nextUserPick;

  const candidates = candidateSet(available, baselines);

  // Raw components.
  const rawVor = candidates.map((p) => vor(p, baselines));
  // Chance the player is still on the board at the pick being advised.
  const rawAvail = candidates.map((p) =>
    userOnClock ? 1 : survivalProbability(p, current, cEval),
  );
  // Chance the player survives FROM the advised pick to the one after it
  // (the take-now-or-wait question, asked at the pick you control).
  const rawSurvival = candidates.map((p) =>
    cFollow === null ? 1 : survivalProbability(p, cEval, cFollow),
  );
  const rawDrop = candidates.map((p) => dropOff(p, available, baselines, current, cFollow));
  const rawUrgency = candidates.map((_, i) => (1 - rawSurvival[i]!) * Math.max(0, rawVor[i]!));
  const rawNeed = candidates.map((p) =>
    rosterNeed(p.position, me.countsByPosition, state.config.roster),
  );
  const rawUpside = candidates.map((p) => clamp(evalPick - p.adp, 0, 30));
  // Projection is normalized within position so cross-position scale
  // differences (QBs score more points) don't drown out VOR.
  const projByPosition = new Map<Position, number[]>();
  for (const pos of PLAYER_POSITIONS) {
    projByPosition.set(
      pos,
      normalize(candidates.filter((p) => p.position === pos).map((p) => p.projectedPoints)),
    );
  }
  const posCursor = new Map<Position, number>();
  const rawProj = candidates.map((p) => {
    const idx = posCursor.get(p.position) ?? 0;
    posCursor.set(p.position, idx + 1);
    return projByPosition.get(p.position)![idx]!;
  });

  const nVor = normalize(rawVor);
  const nDrop = normalize(rawDrop);
  const nUrgency = normalize(rawUrgency);
  const nUpside = normalize(rawUpside);

  const w = strategy.weights;
  const riskUpsideMult =
    strategy.riskTolerance === 'aggressive' ? 1.3 : strategy.riskTolerance === 'conservative' ? 0.7 : 1;
  const weightSum =
    w.projection + w.vor + w.scarcity + w.survival + w.rosterNeed + w.upside * riskUpsideMult || 1;

  const bestVorByPosition = new Map<Position, number>();
  candidates.forEach((p, i) => {
    bestVorByPosition.set(
      p.position,
      Math.max(bestVorByPosition.get(p.position) ?? -Infinity, rawVor[i]!),
    );
  });

  const noteStances = resolvePlayerNotes(allPlayers, strategy.playerNotes);

  const scored: ScoredPlayer[] = candidates.map((player, i) => {
    const components: ComponentBreakdown = {
      projection: rawProj[i]!,
      vor: nVor[i]!,
      scarcity: nDrop[i]!,
      survival: nUrgency[i]!,
      rosterNeed: rawNeed[i]!,
      upside: nUpside[i]!,
    };
    let score =
      (100 *
        (w.projection * components.projection +
          w.vor * components.vor +
          w.scarcity * components.scarcity +
          w.survival * components.survival +
          w.rosterNeed * components.rosterNeed +
          w.upside * riskUpsideMult * components.upside)) /
      weightSum;

    // Off the clock the score is EXPECTED value at the pick being advised:
    // a player who will not reach you is not a recommendation, however good.
    score *= rawAvail[i]!;

    const reasons: string[] = [];
    const cautions: string[] = [];

    // Strategy position priority.
    const priority = strategy.positionPriorities[player.position] ?? 'normal';
    score *= PRIORITY_MULTIPLIER[priority];

    // Personal player reads from the strategy.
    const stance = noteStances.get(player.playerId);
    if (stance === 'target') {
      score *= TARGET_MULTIPLIER;
      reasons.push('You marked this player as undervalued.');
    } else if (stance === 'avoid') {
      score *= AVOID_MULTIPLIER;
      cautions.push('You marked this player as overvalued.');
    }

    // Reach discipline: value alone does not justify taking a player far
    // ahead of where the market drafts him, because a comparable board will
    // usually offer him (or his tier) later. Measured against the pick being
    // ADVISED (your pick, not an opponent's), in rounds so an 11-pick reach
    // in round 2 stings as much as a 30-pick reach in round 8: grace of half
    // a round, then down to 0.5 by about a 2.5-round reach.
    const reachRounds = (player.adp - evalPick) / state.config.numberOfTeams;
    if (reachRounds > 0.5 && Number.isFinite(evalPick)) {
      score *= clamp(1 - (reachRounds - 0.5) / 2, 0.5, 1);
      cautions.push(
        `Reach: typically drafted around pick ${player.adp.toFixed(0)}, ${Math.round(player.adp - evalPick)} picks after your pick ${evalPick}.`,
      );
    }

    // Strategy rules.
    for (const rule of strategy.rules) {
      if (rule.type === 'limitPosition' && rule.position === player.position) {
        if (me.countsByPosition[player.position] >= rule.max) {
          score *= 0.05;
          cautions.push(`Your strategy caps ${player.position} at ${rule.max} and you are there.`);
        }
      } else if (rule.type === 'avoidPositionBefore' && rule.position === player.position) {
        if (round < rule.round) {
          const bestOther = Math.max(
            ...[...bestVorByPosition.entries()]
              .filter(([pos]) => pos !== player.position)
              .map(([, v]) => v),
            0,
          );
          const advantage = rawVor[i]! - bestOther;
          if (
            rule.exceptionVorAdvantage !== undefined &&
            advantage >= rule.exceptionVorAdvantage
          ) {
            reasons.push(
              `Exceptional value: beats every other position by ${advantage.toFixed(0)} points over replacement, overriding your wait-on-${player.position} rule.`,
            );
          } else {
            score *= rule.penalty;
            cautions.push(
              `Your strategy waits on ${player.position} until round ${rule.round}.`,
            );
          }
        }
      } else if (rule.type === 'boostPositionRounds' && rule.position === player.position) {
        if (round >= rule.fromRound && round <= rule.toRound) {
          score *= rule.multiplier;
        }
      }
    }

    // Human-readable reasoning from the dominant components.
    const surv = rawSurvival[i]!;
    const inTier = remainingInTier(player, available, tiers);
    if (components.vor > 0.85) reasons.push('Elite value over replacement at the position.');
    else if (components.vor > 0.6) reasons.push('Strong value over replacement.');
    if (rawDrop[i]! > 0) {
      if (inTier <= 2 && Number.isFinite(inTier)) {
        reasons.push(
          `Last of a tier: only ${inTier === 1 ? 'this player is' : `${inTier} players are`} left in tier ${tiers.get(player.playerId)} at ${player.position}, then production drops.`,
        );
      } else if (components.scarcity > 0.7) {
        reasons.push(`Waiting is costly: the ${player.position} group thins out before your next pick.`);
      }
    }
    // Urgency ("take now before he's gone") is only a reason when you can
    // actually take him now.
    if (userOnClock && cFollow !== null && surv < 0.35) {
      reasons.push(
        `Only ${(surv * 100).toFixed(0)}% chance of surviving to your next pick (${displayHorizon}).`,
      );
    }
    // Between picks, availability at YOUR pick is the framing: low odds are
    // a caution, good odds a reason.
    if (!userOnClock) {
      const avail = rawAvail[i]!;
      if (avail < 0.35) {
        cautions.push(
          `Only ${(avail * 100).toFixed(0)}% likely to reach your pick ${evalPick}; plan a fallback.`,
        );
      } else if (avail > 0.65) {
        reasons.push(
          `${(avail * 100).toFixed(0)}% likely to still be there at your pick ${evalPick}.`,
        );
      }
    }
    if (components.rosterNeed >= 1) reasons.push(`Fills an open ${player.position} starter slot.`);
    else if (components.rosterNeed >= 0.55) reasons.push('Fits an open flex spot.');
    if (rawUpside[i]! >= 8) {
      reasons.push(`Falling value: typically drafted around pick ${player.adp.toFixed(0)}.`);
    }
    // "You could wait" only makes sense on the clock, and only when
    // opponents actually pick before your next turn (not at a snake turn).
    if (userOnClock && oppEvalToFollow > 0 && surv > 0.7) {
      cautions.push(
        `${(surv * 100).toFixed(0)}% likely to still be available at your next pick, so you could wait.`,
      );
    }
    if (userOnClock && rawDrop[i]! < 0 && oppEvalToFollow > 0) {
      cautions.push('A comparable player at this position will probably still be there next turn.');
    }
    if (rawNeed[i]! < 0.2) {
      cautions.push(`You are already deep at ${player.position}.`);
    }
    if (player.injuryStatus && player.injuryStatus.toLowerCase() !== 'healthy') {
      cautions.push(`Injury status: ${player.injuryStatus}.`);
    }

    return {
      player,
      score: clamp(score, 0, 100),
      components,
      vorValue: rawVor[i]!,
      dropOffValue: rawDrop[i]!,
      // What "your next pick" means to the reader: on the clock it is the
      // pick after this one; between picks it is the pick being advised.
      survivalToNextPick: userOnClock ? surv : rawAvail[i]!,
      availabilityAtYourPick: rawAvail[i]!,
      tier: tiers.get(player.playerId),
      remainingInTier: Number.isFinite(inTier) ? inTier : 0,
      reasons,
      cautions,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // "Will he make it back?" — the players you most care about next turn:
  // highest scored players plus anyone with a scary survival number.
  const survivalBoard = scored
    .slice(0, 10)
    .map((s) => ({ player: s.player, probability: s.survivalToNextPick }))
    .sort((a, b) => a.probability - b.probability);

  // Cost of waiting one of YOUR turns: expected best at the pick being
  // advised versus expected best at the pick after it.
  const waitByPosition: WaitAnalysis[] = PLAYER_POSITIONS.map((position) => {
    const atPos = scored.filter((s) => s.player.position === position);
    const bestNow = atPos[0] ?? null;
    const expectedAtEval = expectedBestVorAtPick(position, available, baselines, current, cEval);
    const expectedBest =
      cFollow === null
        ? 0
        : expectedBestVorAtPick(position, available, baselines, current, cFollow);
    return {
      position,
      bestNow: bestNow?.player ?? null,
      bestNowVor: expectedAtEval,
      expectedBestVorAtNextPick: expectedBest,
      costOfWaiting: expectedAtEval - expectedBest,
    };
  });

  // Two-pick planning: pair each top candidate at the advised pick with the
  // best expected position at the FOLLOWING user pick (never the same pick).
  const pairOptions: PairOption[] = [];
  const pairHorizon = cFollow;
  if (pairHorizon !== null) {
    for (const cand of scored.slice(0, 6)) {
      const availWithout = available.filter((p) => p.playerId !== cand.player.playerId);
      let bestPos: Position | null = null;
      let bestExpected = -Infinity;
      for (const position of PLAYER_POSITIONS) {
        if (position === 'K' || position === 'DST') continue;
        const expected = expectedBestVorAtPick(
          position,
          availWithout,
          baselines,
          current,
          pairHorizon,
        );
        if (expected > bestExpected) {
          bestExpected = expected;
          bestPos = position;
        }
      }
      if (bestPos === null) continue;
      const likely = availWithout
        .filter((p) => p.position === bestPos)
        .map((p) => ({
          p,
          weight:
            vor(p, baselines) * survivalProbability(p, current, pairHorizon),
        }))
        .sort((a, b) => b.weight - a.weight)[0];
      pairOptions.push({
        now: cand,
        thenPosition: bestPos,
        thenLikelyPlayer: likely?.p ?? null,
        expectedThenVor: bestExpected,
        // The "now" half is expected value: off the clock the candidate may
        // not reach the advised pick at all.
        combinedValue: cand.availabilityAtYourPick * cand.vorValue + bestExpected,
      });
    }
    pairOptions.sort((a, b) => b.combinedValue - a.combinedValue);
  }

  return {
    best: scored[0] ?? null,
    alternatives: scored.slice(1, 5),
    scored,
    survivalBoard,
    waitByPosition,
    pairOptions,
    baselines,
    nextUserPick,
    userPickAfterNext,
  };
}
