import type { LeagueConfig, Position } from '../src/config/league';
import { DEFAULT_LEAGUE } from '../src/config/league';
import type { Player } from '../src/data/player';

/**
 * Synthetic player pool: enough depth at every position for a full 12-team
 * draft, with descending projections and ADPs interleaved realistically.
 */
export function syntheticPool(): Player[] {
  const spec: { pos: Position; count: number; top: number; slope: number; adpStart: number; adpGap: number }[] = [
    { pos: 'RB', count: 60, top: 320, slope: 4.2, adpStart: 1, adpGap: 4.1 },
    { pos: 'WR', count: 70, top: 310, slope: 3.4, adpStart: 2, adpGap: 3.6 },
    { pos: 'QB', count: 28, top: 380, slope: 6.5, adpStart: 25, adpGap: 8 },
    { pos: 'TE', count: 24, top: 240, slope: 6.0, adpStart: 20, adpGap: 9 },
    { pos: 'K', count: 16, top: 150, slope: 2.0, adpStart: 150, adpGap: 3 },
    { pos: 'DST', count: 16, top: 140, slope: 2.0, adpStart: 145, adpGap: 3 },
  ];
  const players: Player[] = [];
  for (const s of spec) {
    for (let i = 0; i < s.count; i++) {
      players.push({
        playerId: `${s.pos.toLowerCase()}${i + 1}`,
        name: `${s.pos} Player ${i + 1}`,
        team: 'FA',
        position: s.pos,
        projectedPoints: Math.max(10, s.top - i * s.slope),
        adp: s.adpStart + i * s.adpGap,
        positionalRank: i + 1,
      });
    }
  }
  return players;
}

export function league(overrides: Partial<LeagueConfig> = {}): LeagueConfig {
  return { ...DEFAULT_LEAGUE, ...overrides, roster: { ...DEFAULT_LEAGUE.roster, ...(overrides.roster ?? {}) } };
}
