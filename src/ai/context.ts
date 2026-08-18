import type { DraftState } from '../draft/state';
import { userRoster } from '../draft/state';
import type { Recommendation } from '../engine/recommend';
import type { DraftStrategy } from '../strategy/types';

/**
 * Compact JSON snapshot of the engine's outputs for the in-draft assistant.
 * The model explains these numbers; it never computes its own. Keep this
 * small: it is resent with every question.
 */
export function buildDraftSnapshot(
  state: DraftState,
  rec: Recommendation | null,
  strategy: DraftStrategy,
): unknown {
  const me = userRoster(state);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const pct = (x: number) => Math.round(x * 100);

  return {
    league: {
      teams: state.config.numberOfTeams,
      draftType: state.config.draftType,
      scoring: state.config.scoringFormat,
      userSlot: state.config.userDraftSlot,
      roster: state.config.roster,
    },
    draft: {
      currentPick: state.currentPick,
      currentRound: state.currentRound,
      slotOnClock: state.slotOnClock,
      userIsOnClock: state.slotOnClock === state.config.userDraftSlot,
      nextUserPick: state.nextUserPick,
      picksUntilUserPick: state.picksUntilUserPick,
      userPickAfterNext: state.userPickAfterNext,
      complete: state.complete,
    },
    myRoster: me.players.map((p) => ({ name: p.name, position: p.position })),
    recentPicks: state.picks.slice(-12).map((p) => ({
      overall: p.overall,
      slot: p.slot,
      player: state.pool.get(p.playerId)?.name,
      position: state.pool.get(p.playerId)?.position,
    })),
    topCandidates: (rec?.scored ?? []).slice(0, 12).map((s) => ({
      name: s.player.name,
      position: s.player.position,
      team: s.player.team,
      adp: r1(s.player.adp),
      projectedPoints: r1(s.player.projectedPoints),
      score: r1(s.score),
      vor: r1(s.vorValue),
      tier: s.tier,
      leftInTier: s.remainingInTier,
      survivalToNextUserPickPct: pct(s.survivalToNextPick),
      dropOffVsWaiting: r1(s.dropOffValue),
      engineReasons: s.reasons,
      engineCautions: s.cautions,
    })),
    costOfWaitingByPosition: (rec?.waitByPosition ?? []).map((w) => ({
      position: w.position,
      bestNow: w.bestNow?.name ?? null,
      bestNowVor: r1(w.bestNowVor),
      expectedBestVorAtNextPick: r1(w.expectedBestVorAtNextPick),
      vorLostByWaiting: r1(w.costOfWaiting),
    })),
    twoPickPlans: (rec?.pairOptions ?? []).slice(0, 3).map((o) => ({
      pickNow: o.now.player.name,
      thenTarget: o.thenPosition,
      likelyPlayerThen: o.thenLikelyPlayer?.name ?? null,
      combinedValue: r1(o.combinedValue),
    })),
    replacementBaselines: rec
      ? [...rec.baselines.values()].map((b) => ({
          position: b.position,
          replacementPlayer: b.replacementPlayerName,
          replacementPoints: r1(b.replacementPoints),
        }))
      : [],
    activeStrategy: {
      name: strategy.name,
      riskTolerance: strategy.riskTolerance,
      weights: strategy.weights,
      positionPriorities: strategy.positionPriorities,
      rules: strategy.rules,
      playerNotes: strategy.playerNotes,
    },
  };
}
