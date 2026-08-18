import { describe, expect, it } from 'vitest';
import { applyPick, createDraft } from '../src/draft/state';
import { recommend } from '../src/engine/recommend';
import { BALANCED_VALUE, LATE_ROUND_QB, QUANT_1_01 } from '../src/strategy/presets';
import { league, syntheticPool } from './fixtures';

describe('recommendations', () => {
  it('never recommends a drafted player', () => {
    let s = createDraft(league(), syntheticPool());
    const first = recommend(s, QUANT_1_01);
    const bestId = first.best!.player.playerId;
    s = applyPick(s, bestId);
    const second = recommend(s, QUANT_1_01);
    expect(second.scored.some((sc) => sc.player.playerId === bestId)).toBe(false);
    expect(second.survivalBoard.some((row) => row.player.playerId === bestId)).toBe(false);
  });

  it('penalizes early QBs under a late-round QB strategy', () => {
    const s = createDraft(league(), syntheticPool());
    const rec = recommend(s, LATE_ROUND_QB);
    // qb1 has the highest raw projection in the synthetic pool; the strategy
    // must keep every QB out of the top recommendations in round 1.
    const topFive = [rec.best!, ...rec.alternatives];
    expect(topFive.some((sc) => sc.player.position === 'QB')).toBe(false);
    const qb = rec.scored.find((sc) => sc.player.position === 'QB');
    expect(qb).toBeDefined();
    expect(qb!.cautions.join(' ')).toMatch(/waits on QB/);
  });

  it('does not recommend kickers or defenses early', () => {
    const s = createDraft(league(), syntheticPool());
    const rec = recommend(s, BALANCED_VALUE);
    const topTen = rec.scored.slice(0, 10);
    expect(topTen.some((sc) => sc.player.position === 'K' || sc.player.position === 'DST')).toBe(
      false,
    );
  });

  it('produces survival probabilities that fall with longer waits', () => {
    // Slot 1 waits 22 picks; slot 6 waits at most 12. The same early player
    // should be safer for slot 6's next pick than slot 1's.
    const pool = syntheticPool();
    const s1 = createDraft(league({ userDraftSlot: 1 }), pool);
    const s6 = createDraft(league({ userDraftSlot: 6 }), pool);
    // Advance both to just after the user's first pick round-trip equivalent:
    // compare survival for the same player to each user's next pick from pick 1.
    let a = s1;
    a = applyPick(a, 'rb1'); // user slot 1 picks
    let b = s6;
    for (const id of ['rb1', 'wr1', 'rb2', 'wr2', 'rb3']) b = applyPick(b, id);
    b = applyPick(b, 'wr3'); // slot 6 (user) picks at 6
    const recA = recommend(a, BALANCED_VALUE); // next user pick 24, 22 away
    const recB = recommend(b, BALANCED_VALUE); // next user pick 15, 8 away
    const target = 'rb6';
    const survA = recA.scored.find((sc) => sc.player.playerId === target)?.survivalToNextPick;
    const survB = recB.scored.find((sc) => sc.player.playerId === target)?.survivalToNextPick;
    expect(survA).toBeDefined();
    expect(survB).toBeDefined();
    expect(survA!).toBeLessThan(survB!);
  });

  it('gives every recommendation at least one reason', () => {
    const s = createDraft(league(), syntheticPool());
    const rec = recommend(s, QUANT_1_01);
    expect(rec.best!.reasons.length).toBeGreaterThan(0);
  });

  it('builds two-pick pair options around the turn', () => {
    const s = createDraft(league({ userDraftSlot: 1 }), syntheticPool());
    const rec = recommend(s, QUANT_1_01);
    expect(rec.pairOptions.length).toBeGreaterThan(0);
    const top = rec.pairOptions[0]!;
    expect(top.combinedValue).toBeGreaterThan(0);
    expect(top.now.player.playerId).not.toBe(top.thenLikelyPlayer?.playerId);
  });

  it('caps positions per strategy limits', () => {
    let s = createDraft(league({ userDraftSlot: 1 }), syntheticPool());
    // User drafts two QBs (the QUANT_1_01 cap) by alternating with others.
    s = applyPick(s, 'qb1'); // user pick 1
    for (let i = 0; i < 22; i++) s = applyPick(s, s.availablePlayers.find((p) => p.position !== 'QB')!.playerId);
    s = applyPick(s, 'qb2'); // user pick 24
    const rec = recommend(s, QUANT_1_01); // user on the clock at 25
    const qb = rec.scored.find((sc) => sc.player.position === 'QB');
    if (qb) {
      expect(qb.score).toBeLessThan(10);
      expect(qb.cautions.join(' ')).toMatch(/caps QB/);
    }
  });
});

describe('reach discipline', () => {
  it('penalizes taking a player far ahead of his market price', () => {
    // Two equal WRs except one is priced two rounds later.
    const pool = syntheticPool().map((p) =>
      p.playerId === 'wr2' ? { ...p, adp: 40 } : p,
    );
    const s = createDraft(league({ userDraftSlot: 1 }), pool);
    const rec = recommend(s, BALANCED_VALUE);
    const wr2 = rec.scored.find((sc) => sc.player.playerId === 'wr2')!;
    expect(wr2.cautions.join(' ')).toMatch(/Reach/);
    // The same player without the reach must outscore the reach version.
    const fairPool = syntheticPool();
    const fair = recommend(createDraft(league({ userDraftSlot: 1 }), fairPool), BALANCED_VALUE);
    const wr2Fair = fair.scored.find((sc) => sc.player.playerId === 'wr2')!;
    expect(wr2.score).toBeLessThan(wr2Fair.score);
  });

  it('ships the probabilistic VOLS preset as the default', async () => {
    const { DEFAULT_STRATEGY, STRATEGY_PRESETS } = await import('../src/strategy/presets');
    expect(DEFAULT_STRATEGY.id).toBe('probabilistic-vols-1-01');
    expect(STRATEGY_PRESETS[0]!.id).toBe('probabilistic-vols-1-01');
  });
});

describe('turn awareness (back-to-back picks)', () => {
  it('everyone survives to your next pick when no opponent picks in between', () => {
    // Slot 12 of 12 owns picks 12 and 13: zero opponents between them.
    const pool = syntheticPool();
    let s = createDraft(league({ userDraftSlot: 12 }), pool);
    for (let i = 0; i < 11; i++) s = applyPick(s, s.availablePlayers[0]!.playerId);
    expect(s.slotOnClock).toBe(12);
    const rec = recommend(s, BALANCED_VALUE);
    for (const sc of rec.scored.slice(0, 10)) {
      expect(sc.survivalToNextPick).toBe(1);
      expect(sc.cautions.join(' ')).not.toMatch(/you could wait/);
    }
  });

  it('counts only opponent picks toward the horizon off the turn', async () => {
    const { opponentPicksBetween } = await import('../src/draft/order');
    const cfg = league({ numberOfTeams: 12, userDraftSlot: 1 });
    // From pick 1 (user's own) to pick 24: picks 2..23 are all opponents.
    expect(opponentPicksBetween(cfg, 1, 1, 24)).toBe(22);
    // At the turn: pick 24 to 25 for slot 12... for slot 1, picks 24 and 25
    // are both the user's, so zero opponents in [24, 25).
    expect(opponentPicksBetween(cfg, 1, 24, 25)).toBe(0);
    expect(opponentPicksBetween(cfg, 12, 12, 13)).toBe(0);
  });

  it('decision tree leaves are certainties at the turn', async () => {
    const { buildDecisionTree } = await import('../src/engine/decisionTree');
    const pool = syntheticPool();
    let s = createDraft(league({ userDraftSlot: 12 }), pool);
    for (let i = 0; i < 11; i++) s = applyPick(s, s.availablePlayers[0]!.playerId);
    const rec = recommend(s, BALANCED_VALUE);
    const tree = buildDecisionTree(s, rec)!;
    expect(tree.followUpPick).toBe(13);
    for (const branch of tree.branches) {
      const survives = branch.leaves.find((l) => l.outcome === 'survives');
      if (survives) expect(survives.probability).toBe(1);
    }
  });

  it('scales the reach penalty by rounds, not raw picks', () => {
    // An 11-pick reach in round 2 of a 12-teamer must be penalized.
    const pool = syntheticPool().map((p) =>
      p.playerId === 'wr3' ? { ...p, adp: 25 } : p,
    );
    let s = createDraft(league({ userDraftSlot: 1 }), pool);
    s = applyPick(s, 'rb1');
    for (let i = 0; i < 11; i++) s = applyPick(s, s.availablePlayers[0]!.playerId);
    // Current pick 13; wr3 priced at 25 -> a ~1 round reach.
    const rec = recommend(s, BALANCED_VALUE);
    const wr3 = rec.scored.find((sc) => sc.player.playerId === 'wr3');
    if (wr3) expect(wr3.cautions.join(' ')).toMatch(/Reach/);
  });
});
