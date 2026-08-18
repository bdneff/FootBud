import { describe, expect, it } from 'vitest';
import { mergeFetchedPlayers } from '../src/data/sources/aggregate';
import { parseEspnPlayers } from '../src/data/sources/espn';
import { parseSleeperRows } from '../src/data/sources/sleeper';
import { currentSeason, normalizePlayerKey } from '../src/data/sources/types';

function sleeperRow(
  id: string,
  first: string,
  last: string,
  position: string,
  team: string,
  pts: number,
  adp: number | null,
) {
  return {
    player_id: id,
    player: { first_name: first, last_name: last, position, team, injury_status: null },
    stats: {
      pts_half_ppr: pts,
      pts_ppr: pts + 10,
      pts_std: pts - 10,
      adp_half_ppr: adp,
      adp_ppr: adp,
      adp_std: adp,
    },
  };
}

function sleeperFixture(count: number) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push(sleeperRow(`${i}`, 'Player', `Number${i}`, i % 2 ? 'RB' : 'WR', 'FA', 300 - i, i + 1));
  }
  rows.push(sleeperRow('def1', 'San Francisco', '49ers', 'DEF', 'SF', 120, 140.5));
  rows.push(sleeperRow('nopts', 'Zero', 'Points', 'RB', 'FA', 0, 50)); // dropped
  rows.push({ player_id: 'junk' }); // malformed row ignored
  rows.push(sleeperRow('noadp', 'Deep', 'Sleeper', 'WR', 'FA', 90, null)); // synthetic ADP
  return rows;
}

describe('Sleeper parser', () => {
  it('parses rows, maps DEF to DST, and drops zero-point or malformed rows', () => {
    const { players, sourceName } = parseSleeperRows(sleeperFixture(120), 'half_ppr');
    expect(sourceName).toMatch(/Sleeper/);
    const dst = players.find((p) => p.position === 'DST');
    expect(dst?.name).toBe('San Francisco 49ers');
    expect(players.some((p) => p.name === 'Zero Points')).toBe(false);
    expect(players.some((p) => p.playerId === 'sleeper-junk')).toBe(false);
  });

  it('assigns synthetic trailing ADP to players without one', () => {
    const { players } = parseSleeperRows(sleeperFixture(120), 'half_ppr');
    const deep = players.find((p) => p.name === 'Deep Sleeper')!;
    const maxReal = 140.5;
    expect(deep.adp).toBeGreaterThan(maxReal);
  });

  it('uses the scoring format points column', () => {
    const { players } = parseSleeperRows(sleeperFixture(120), 'ppr');
    const p0 = players.find((p) => p.name === 'Player Number0')!;
    expect(p0.projectedPoints).toBe(310); // pts_ppr = pts + 10
  });

  it('rejects tiny or malformed responses', () => {
    expect(() => parseSleeperRows({ not: 'an array' }, 'ppr')).toThrow(/unexpected/);
    expect(() => parseSleeperRows(sleeperFixture(10), 'ppr')).toThrow(/usable players/);
  });
});

function espnEntry(id: number, name: string, posId: number, teamId: number, pts: number, adp?: number) {
  return {
    player: {
      id,
      fullName: name,
      defaultPositionId: posId,
      proTeamId: teamId,
      ownership: adp !== undefined ? { averageDraftPosition: adp } : undefined,
      stats: [
        { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: pts },
        { seasonId: 2026, statSourceId: 0, statSplitTypeId: 0, appliedTotal: 999 }, // actuals ignored
      ],
    },
  };
}

describe('ESPN parser', () => {
  it('parses projection rows with position and team mapping', () => {
    const entries = [];
    for (let i = 0; i < 120; i++) {
      entries.push(espnEntry(i, `Espn Player${i}`, (i % 4) + 1, 25, 280 - i, i + 1));
    }
    const { players } = parseEspnPlayers({ players: entries }, 'ppr', 2026);
    expect(players.length).toBe(120);
    expect(players[0]!.name).toBe('Espn Player0');
    expect(players[0]!.team).toBe('SF');
    expect(players[0]!.projectedPoints).toBe(280); // projection, not the 999 actuals row
  });

  it('warns on half-PPR (ESPN only publishes PPR defaults)', () => {
    const entries = Array.from({ length: 120 }, (_, i) =>
      espnEntry(i, `P ${i}`, 2, 1, 250 - i, i + 1),
    );
    const { warnings } = parseEspnPlayers({ players: entries }, 'half_ppr', 2026);
    expect(warnings.join(' ')).toMatch(/half-PPR/);
  });
});

describe('aggregate merge', () => {
  it('averages points and ADP for players known to multiple sources', () => {
    const a = {
      players: [
        { playerId: 's1', name: 'Bijan Robinson', team: 'ATL', position: 'RB' as const, projectedPoints: 300, adp: 2 },
        { playerId: 's2', name: 'Only Sleeper', team: 'FA', position: 'WR' as const, projectedPoints: 200, adp: 30 },
      ],
      sourceName: 'Sleeper projections',
      warnings: [],
    };
    const b = {
      players: [
        { playerId: 'e1', name: 'Bijan Robinson', team: 'ATL', position: 'RB' as const, projectedPoints: 280, adp: 4 },
        { playerId: 'e2', name: 'Only Espn', team: 'FA', position: 'TE' as const, projectedPoints: 150, adp: 60 },
      ],
      sourceName: 'ESPN projections',
      warnings: ['espn warning'],
    };
    const merged = mergeFetchedPlayers([a, b]);
    expect(merged.players.length).toBe(3);
    const bijan = merged.players.find((p) => p.name === 'Bijan Robinson')!;
    expect(bijan.projectedPoints).toBe(290);
    expect(bijan.adp).toBe(3);
    expect(merged.sourceName).toMatch(/Aggregate/);
    expect(merged.warnings).toContain('espn warning');
    // Single-source players carry through untouched.
    expect(merged.players.find((p) => p.name === 'Only Sleeper')!.projectedPoints).toBe(200);
  });

  it('passes a single result through and rejects zero results', () => {
    const only = { players: [], sourceName: 'X', warnings: [] };
    expect(mergeFetchedPlayers([only])).toBe(only);
    expect(() => mergeFetchedPlayers([])).toThrow(/No projection source/);
  });
});

describe('source helpers', () => {
  it('computes the NFL season year across the calendar flip', () => {
    expect(currentSeason(new Date('2026-08-18'))).toBe(2026);
    expect(currentSeason(new Date('2027-01-15'))).toBe(2026);
    expect(currentSeason(new Date('2027-05-01'))).toBe(2027);
  });

  it('normalizes player keys so sources match each other', () => {
    expect(normalizePlayerKey('Brian Thomas Jr.', 'WR')).toBe(normalizePlayerKey('Brian Thomas', 'WR'));
    expect(normalizePlayerKey("Ja'Marr Chase", 'WR')).toBe(normalizePlayerKey('JaMarr Chase', 'WR'));
    expect(normalizePlayerKey('Josh Allen', 'QB')).not.toBe(normalizePlayerKey('Josh Allen', 'WR'));
  });
});
