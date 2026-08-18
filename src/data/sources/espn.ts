import type { ScoringFormat } from '../../config/league';
import { PlayerSchema, type Player } from '../player';
import type { FetchedPlayers, ProjectionSource } from './types';
import { currentSeason } from './types';

/**
 * ESPN fantasy projections. The endpoint is real and public, but ESPN does
 * not send CORS headers, so browsers normally refuse to deliver the
 * response to a web app like FootBud. We try anyway (it costs nothing and
 * would start working if ESPN ever allowed it) and fail with an honest
 * explanation otherwise.
 */

/** leaguedefaults segment id per scoring format (ESPN's PPR default is 3). */
const SCORING_LEAGUE_ID: Record<ScoringFormat, number> = {
  standard: 1,
  half_ppr: 3, // ESPN has no half-PPR default; PPR default with a warning
  ppr: 3,
};

const POSITION_BY_ID: Record<number, string> = {
  1: 'QB',
  2: 'RB',
  3: 'WR',
  4: 'TE',
  5: 'K',
  16: 'DST',
};

const TEAM_BY_ID: Record<number, string> = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL',
  34: 'HOU',
};

interface EspnPlayerEntry {
  player?: {
    id?: number;
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
    injuryStatus?: string;
    ownership?: { averageDraftPosition?: number };
    stats?: {
      seasonId?: number;
      statSourceId?: number; // 1 = projection
      statSplitTypeId?: number; // 0 = full season
      appliedTotal?: number;
    }[];
  };
}

/** Pure parser so it can be unit tested without the network. */
export function parseEspnPlayers(
  data: unknown,
  scoring: ScoringFormat,
  season: number,
): FetchedPlayers {
  const entries = (data as { players?: EspnPlayerEntry[] })?.players;
  if (!Array.isArray(entries)) {
    throw new Error('ESPN returned an unexpected response shape.');
  }
  const warnings: string[] = [];
  if (scoring === 'half_ppr') {
    warnings.push('ESPN has no half-PPR default projections; using their PPR numbers.');
  }
  const players: Player[] = [];
  for (const entry of entries) {
    const p = entry.player;
    const pos = POSITION_BY_ID[p?.defaultPositionId ?? -1];
    if (!p || !pos || !p.fullName || typeof p.id !== 'number') continue;
    const projection = p.stats?.find(
      (s) => s.seasonId === season && s.statSourceId === 1 && s.statSplitTypeId === 0,
    )?.appliedTotal;
    if (!projection || projection <= 0) continue;
    const adp = p.ownership?.averageDraftPosition;
    const parsed = PlayerSchema.safeParse({
      playerId: `espn-${p.id}`,
      name: p.fullName,
      team: TEAM_BY_ID[p.proTeamId ?? 0] ?? 'FA',
      position: pos,
      projectedPoints: projection,
      adp: adp && adp > 0 ? adp : 400,
      injuryStatus:
        p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus.toLowerCase() : undefined,
    });
    if (parsed.success) players.push(parsed.data);
  }
  players.sort((a, b) => a.adp - b.adp);
  if (players.length < 100) {
    throw new Error(`ESPN returned only ${players.length} usable players.`);
  }
  return { players: players.slice(0, 400), sourceName: 'ESPN projections', warnings };
}

export const espnSource: ProjectionSource = {
  id: 'espn',
  label: 'ESPN',
  description:
    'ESPN projections and ADP. ESPN usually blocks browser apps from reading its API, so this may fail; export a CSV from ESPN instead if it does.',
  availability: 'blocked',
  async fetchPlayers(scoring) {
    const season = currentSeason();
    const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/${SCORING_LEAGUE_ID[scoring]}?view=kona_player_info`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          'x-fantasy-filter': JSON.stringify({
            players: {
              limit: 400,
              sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'STANDARD' },
            },
          }),
        },
      });
    } catch {
      throw new Error(
        'ESPN blocked the request (their API does not allow browser apps). Export projections from ESPN as a CSV and use Upload CSV, or use Sleeper.',
      );
    }
    if (!res.ok) {
      throw new Error(`ESPN API responded ${res.status}. Try Sleeper or a CSV instead.`);
    }
    return parseEspnPlayers(await res.json(), scoring, season);
  },
};
