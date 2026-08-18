import { describe, expect, it } from 'vitest';
import { applyPick, createDraft } from '../src/draft/state';
import { buildDecisionTree } from '../src/engine/decisionTree';
import { recommend } from '../src/engine/recommend';
import { QUANT_1_01 } from '../src/strategy/presets';
import { league, syntheticPool } from './fixtures';

function treeAtStart() {
  const state = createDraft(league({ userDraftSlot: 1 }), syntheticPool());
  const rec = recommend(state, QUANT_1_01);
  return { state, rec, tree: buildDecisionTree(state, rec)! };
}

describe('decision tree', () => {
  it('builds pruned, position-diverse branches for the deciding pick', () => {
    const { tree } = treeAtStart();
    expect(tree).not.toBeNull();
    expect(tree.decidingPick).toBe(1);
    expect(tree.followUpPick).toBe(24);
    expect(tree.branches.length).toBeLessThanOrEqual(4);
    const positions = tree.branches.map((b) => b.pickNow.position);
    for (const pos of new Set(positions)) {
      expect(positions.filter((p) => p === pos).length).toBeLessThanOrEqual(2);
    }
    expect(positions).not.toContain('K');
    expect(positions).not.toContain('DST');
  });

  it('orders branches by expected value and marks complementary outcomes', () => {
    const { tree } = treeAtStart();
    for (let i = 1; i < tree.branches.length; i++) {
      expect(tree.branches[i - 1]!.expectedValue).toBeGreaterThanOrEqual(
        tree.branches[i]!.expectedValue,
      );
    }
    for (const branch of tree.branches) {
      expect(branch.leaves.length).toBe(2);
      const [survives, gone] = branch.leaves;
      expect(survives!.probability + gone!.probability).toBeCloseTo(1, 6);
      // EV decomposition holds.
      const ev =
        branch.pickNowVor +
        survives!.probability * survives!.value +
        gone!.probability * gone!.value;
      expect(branch.expectedValue).toBeCloseTo(ev, 6);
      // Coherence: landing the target must beat missing him, otherwise he
      // is not worth planning around.
      expect(survives!.value).toBeGreaterThanOrEqual(gone!.value);
    }
  });

  it('never plans around the player being drafted in the same branch', () => {
    const { tree } = treeAtStart();
    for (const branch of tree.branches) {
      expect(branch.target?.playerId).not.toBe(branch.pickNow.playerId);
    }
  });

  it('excludes drafted players from branches entirely', () => {
    let state = createDraft(league({ userDraftSlot: 1 }), syntheticPool());
    state = applyPick(state, 'rb1');
    state = applyPick(state, 'wr1');
    const rec = recommend(state, QUANT_1_01);
    const tree = buildDecisionTree(state, rec)!;
    const ids = tree.branches.flatMap((b) => [
      b.pickNow.playerId,
      ...(b.target ? [b.target.playerId] : []),
    ]);
    expect(ids).not.toContain('rb1');
    expect(ids).not.toContain('wr1');
  });

  it('returns null on a completed draft', () => {
    let state = createDraft(league(), syntheticPool());
    while (!state.complete) state = applyPick(state, state.availablePlayers[0]!.playerId);
    const rec = recommend(createDraft(league(), syntheticPool()), QUANT_1_01);
    expect(buildDecisionTree(state, rec)).toBeNull();
  });

  it('handles the last user pick with no follow-up', () => {
    // Tiny league: 4 teams, roster of 2 -> 8 picks; user slot 4 has picks 4 and 5.
    const cfg = league({
      numberOfTeams: 4,
      userDraftSlot: 4,
      roster: { QB: 0, RB: 1, WR: 1, TE: 0, FLEX: 0, SUPERFLEX: 0, K: 0, DST: 0, BENCH: 0 },
    });
    let state = createDraft(cfg, syntheticPool());
    for (const id of ['rb1', 'wr1', 'rb2', 'wr2', 'rb3', 'wr3']) state = applyPick(state, id);
    // Picks 7, 8 remain; user's last pick already passed at 5? No: snake 4 teams,
    // round1: 1,2,3,4(user), round2: 5(user),6,7,8. After 6 picks, pick 7 is slot 2.
    // The user has no remaining picks, so there is no deciding pick.
    const rec = recommend(state, QUANT_1_01);
    const tree = buildDecisionTree(state, rec);
    expect(tree).toBeNull();
  });
});
