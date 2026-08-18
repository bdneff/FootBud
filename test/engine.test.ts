import { describe, expect, it } from 'vitest';
import { demandCount, replacementBaselines, vor } from '../src/engine/replacement';
import { survivalProbability } from '../src/engine/survival';
import { expectedBestVorAtPick } from '../src/engine/scarcity';
import { assignTiers } from '../src/engine/tiers';
import { rosterNeed } from '../src/engine/rosterNeed';
import { league, syntheticPool } from './fixtures';

describe('replacement level and VOR', () => {
  it('raises the replacement baseline (lowering VOR) in larger leagues', () => {
    const pool = syntheticPool();
    const twelve = replacementBaselines(league({ numberOfTeams: 12 }), pool);
    const eight = replacementBaselines(league({ numberOfTeams: 8 }), pool);
    // More teams -> more RBs rostered -> replacement RB is worse -> baseline points lower.
    expect(twelve.get('RB')!.replacementPoints).toBeLessThan(eight.get('RB')!.replacementPoints);
    const rb1 = pool.find((p) => p.playerId === 'rb1')!;
    expect(vor(rb1, twelve)).toBeGreaterThan(vor(rb1, eight));
  });

  it('responds to roster requirements', () => {
    const cfg1 = league();
    const cfg2 = league({ roster: { ...cfg1.roster, QB: 2 } });
    expect(demandCount(cfg2, 'QB')).toBeGreaterThan(demandCount(cfg1, 'QB'));
  });

  it('exposes the baseline player for debugging', () => {
    const baselines = replacementBaselines(league(), syntheticPool());
    expect(baselines.get('RB')!.replacementPlayerName).toMatch(/RB Player/);
  });
});

describe('survival probability', () => {
  const player = syntheticPool().find((p) => p.playerId === 'rb5')!; // adp ~17.4

  it('is 1 when the target pick is now or earlier', () => {
    expect(survivalProbability(player, 10, 10)).toBe(1);
    expect(survivalProbability(player, 10, 8)).toBe(1);
  });

  it('decreases as the wait gets longer', () => {
    const p1 = survivalProbability(player, 10, 14);
    const p2 = survivalProbability(player, 10, 20);
    const p3 = survivalProbability(player, 10, 30);
    expect(p1).toBeGreaterThan(p2);
    expect(p2).toBeGreaterThan(p3);
    expect(p1).toBeLessThanOrEqual(1);
    expect(p3).toBeGreaterThanOrEqual(0);
  });

  it('is near zero far past ADP and near one just after the current pick', () => {
    expect(survivalProbability(player, 10, 60)).toBeLessThan(0.05);
    expect(survivalProbability(player, 10, 11)).toBeGreaterThan(0.85);
  });

  it('conditions on the player still being available now', () => {
    // Player with ADP 17 still on the board at pick 30: survival to 32 should
    // not be computed as if we were at pick 1.
    const p = survivalProbability(player, 30, 32);
    expect(p).toBeGreaterThan(0.3);
  });
});

describe('scarcity', () => {
  it('expected best VOR at a future pick is below the current best VOR', () => {
    const pool = syntheticPool();
    const cfg = league();
    const baselines = replacementBaselines(cfg, pool);
    const bestNow = Math.max(...pool.filter((p) => p.position === 'RB').map((p) => vor(p, baselines)));
    const expected = expectedBestVorAtPick('RB', pool, baselines, 1, 24);
    expect(expected).toBeLessThan(bestNow);
    expect(expected).toBeGreaterThan(0);
  });
});

describe('tiers', () => {
  it('respects source tiers when provided', () => {
    const pool = syntheticPool().map((p) =>
      p.position === 'QB' ? { ...p, tier: p.positionalRank! <= 3 ? 1 : 2 } : p,
    );
    const tiers = assignTiers(pool);
    expect(tiers.get('qb1')).toBe(1);
    expect(tiers.get('qb10')).toBe(2);
  });

  it('detects gap-based tiers otherwise', () => {
    const pool = syntheticPool();
    const tiers = assignTiers(pool);
    expect(tiers.get('rb1')).toBeDefined();
  });
});

describe('roster need', () => {
  const roster = league().roster;

  it('is maximal while starter slots are open', () => {
    expect(rosterNeed('RB', { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }, roster)).toBe(1);
    expect(rosterNeed('RB', { QB: 0, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 }, roster)).toBe(1);
  });

  it('drops once starters are filled but flex remains', () => {
    const need = rosterNeed('RB', { QB: 1, RB: 2, WR: 2, TE: 1, K: 0, DST: 0 }, roster);
    expect(need).toBeGreaterThan(0.3);
    expect(need).toBeLessThan(1);
  });

  it('is near zero for a second kicker', () => {
    expect(rosterNeed('K', { QB: 1, RB: 4, WR: 4, TE: 1, K: 1, DST: 1 }, roster)).toBe(0);
  });
});

describe('VOLS calibration (probabilistic strategy doc)', () => {
  it('uses a starters-only baseline: bench size never moves it', () => {
    const withBench = league();
    const noBench = league({ roster: { ...withBench.roster, BENCH: 0 } });
    expect(demandCount(withBench, 'RB')).toBe(demandCount(noBench, 'RB'));
    expect(demandCount(withBench, 'QB')).toBe(demandCount(noBench, 'QB'));
  });

  it('shrinks projected gaps by the historical position slope', async () => {
    const { rawVols, CALIBRATION_SLOPE } = await import('../src/engine/replacement');
    const pool = syntheticPool();
    const baselines = replacementBaselines(league(), pool);
    const qb = pool.find((p) => p.playerId === 'qb1')!;
    const wr = pool.find((p) => p.playerId === 'wr1')!;
    expect(vor(qb, baselines)).toBeCloseTo(rawVols(qb, baselines) * CALIBRATION_SLOPE.QB, 6);
    expect(vor(wr, baselines)).toBeCloseTo(rawVols(wr, baselines) * CALIBRATION_SLOPE.WR, 6);
    // QB gaps shrink harder than WR gaps.
    expect(CALIBRATION_SLOPE.QB).toBeLessThan(CALIBRATION_SLOPE.WR);
  });
});
