import { describe, expect, it } from 'vitest';
import { buildDraftSnapshot } from '../src/ai/context';
import { diffStrategies, toDraftStrategy, type AiStrategyOutput } from '../src/ai/schemas';
import { samplePlayers } from '../src/data/sampleData';
import { applyPick, createDraft } from '../src/draft/state';
import { recommend } from '../src/engine/recommend';
import { matchPlayerByName, resolvePlayerNotes } from '../src/strategy/playerMatch';
import { BALANCED_VALUE, QUANT_1_01 } from '../src/strategy/presets';
import { league, syntheticPool } from './fixtures';

const AI_OUTPUT: AiStrategyOutput = {
  name: 'My Custom Plan',
  description: 'Test strategy from the AI.',
  weights: { projection: 0.2, vor: 1.4, scarcity: 0.15, survival: 0.2, rosterNeed: 0.1, upside: -0.2 },
  positionPriorities: { QB: 'patient', RB: 'high', WR: 'high', TE: 'normal', K: 'avoid', DST: 'avoid' },
  rules: [
    {
      type: 'avoidPositionBefore',
      position: 'QB',
      round: 6.7,
      exceptionVorAdvantage: null,
      penalty: 1.8,
    },
    { type: 'boostPositionRounds', position: 'RB', fromRound: 5, toRound: 2, multiplier: 9 },
  ],
  riskTolerance: 'aggressive',
  playerNotes: [{ name: 'RB Player 3', stance: 'target', reason: null }],
  draftSlotMentioned: 4,
  interpretationSummary: ['Waits on QB', 'Targets RB Player 3'],
};

describe('AI strategy conversion', () => {
  it('clamps model numbers into a valid DraftStrategy', () => {
    const s = toDraftStrategy(AI_OUTPUT);
    expect(s.weights.vor).toBe(1);
    expect(s.weights.upside).toBe(0);
    const avoid = s.rules.find((r) => r.type === 'avoidPositionBefore');
    expect(avoid).toMatchObject({ round: 7, penalty: 1 });
    const boost = s.rules.find((r) => r.type === 'boostPositionRounds');
    expect(boost).toMatchObject({ fromRound: 5, toRound: 5, multiplier: 2 });
    expect(s.playerNotes[0]).toEqual({ name: 'RB Player 3', stance: 'target', reason: undefined });
  });

  it('diffs two strategies into readable change lines', () => {
    const before = QUANT_1_01;
    const after = {
      ...BALANCED_VALUE,
      playerNotes: [{ name: 'RB Player 3', stance: 'target' as const }],
    };
    const changes = diffStrategies(before, after);
    expect(changes.some((c) => c.startsWith('Weight'))).toBe(true);
    expect(changes).toContain('Added target: RB Player 3');
  });
});

describe('player name matching', () => {
  const pool = syntheticPool();

  it('matches exact and unique partial names', () => {
    expect(matchPlayerByName(pool, 'RB Player 3')?.playerId).toBe('rb3');
    expect(matchPlayerByName(pool, 'rb player 3')?.playerId).toBe('rb3');
  });

  it('returns null for ambiguous or unknown names', () => {
    expect(matchPlayerByName(pool, 'Player 3')).toBeNull(); // exists at every position
    expect(matchPlayerByName(pool, 'Nobody Realname')).toBeNull();
  });

  it('handles suffixes and punctuation on real names', () => {
    const players = samplePlayers();
    expect(matchPlayerByName(players, 'Brian Thomas')?.name).toBe('Brian Thomas Jr.');
    expect(matchPlayerByName(players, "ja'marr chase")?.name).toBe("Ja'Marr Chase");
    expect(matchPlayerByName(players, 'Nabers')?.name).toBe('Malik Nabers');
  });

  it('resolves notes to player ids', () => {
    const stances = resolvePlayerNotes(pool, [
      { name: 'RB Player 1', stance: 'avoid' },
      { name: 'Unknown Guy', stance: 'target' },
    ]);
    expect(stances.get('rb1')).toBe('avoid');
    expect(stances.size).toBe(1);
  });
});

describe('player notes in the engine', () => {
  it('targets rise and avoids fall in the recommendation score', () => {
    const s = createDraft(league(), syntheticPool());
    const base = recommend(s, BALANCED_VALUE);
    const noted = recommend(s, {
      ...BALANCED_VALUE,
      playerNotes: [
        { name: 'WR Player 2', stance: 'target' },
        { name: 'RB Player 1', stance: 'avoid' },
      ],
    });
    const score = (rec: typeof base, id: string) =>
      rec.scored.find((sc) => sc.player.playerId === id)!.score;
    expect(score(noted, 'wr2')).toBeGreaterThan(score(base, 'wr2'));
    expect(score(noted, 'rb1')).toBeLessThan(score(base, 'rb1'));
    const target = noted.scored.find((sc) => sc.player.playerId === 'wr2')!;
    expect(target.reasons.join(' ')).toMatch(/undervalued/);
  });
});

describe('draft snapshot for the AI assistant', () => {
  it('serializes engine outputs compactly and stays in sync with picks', () => {
    let s = createDraft(league(), samplePlayers());
    s = applyPick(s, s.availablePlayers[0]!.playerId);
    const rec = recommend(s, QUANT_1_01);
    const snapshot = buildDraftSnapshot(s, rec, QUANT_1_01) as Record<string, unknown>;
    const json = JSON.stringify(snapshot);
    expect(json.length).toBeLessThan(20000);
    const draft = snapshot.draft as { currentPick: number };
    expect(draft.currentPick).toBe(2);
    const top = snapshot.topCandidates as { name: string }[];
    expect(top.length).toBeGreaterThan(0);
    // The drafted player must not appear among candidates.
    const drafted = s.picks[0]!.playerId;
    const draftedName = s.pool.get(drafted)!.name;
    expect(top.some((c) => c.name === draftedName)).toBe(false);
  });
});
