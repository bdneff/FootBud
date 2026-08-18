import type { ScoringFormat } from '../../config/league';
import { PlayerSchema, type Player } from '../player';
import type { FetchedPlayers, ProjectionSource } from './types';
import { currentSeason } from './types';

/**
 * Sleeper's public projections API. Open CORS, no auth. Each row carries an
 * embedded player object plus season projections and ADP for every scoring
 * format.
 */

const SCORING_SUFFIX: Record<ScoringFormat, string> = {
  standard: 'std',
  half_ppr: 'half_ppr',
  ppr: 'ppr',
};

interface SleeperRow {
  player_id?: string;
  player?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string | null;
    injury_status?: string | null;
  };
  stats?: Record<string, number | null | undefined>;
}

const POSITION_MAP: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DST',
};

/** Pure parser so it can be unit tested without the network. */
export function parseSleeperRows(rows: unknown, scoring: ScoringFormat): FetchedPlayers {
  if (!Array.isArray(rows)) {
    throw new Error('Sleeper returned an unexpected response shape.');
  }
  const suffix = SCORING_SUFFIX[scoring];
  const warnings: string[] = [];
  const candidates: { player: Player; hasRealAdp: boolean }[] = [];

  for (const raw of rows as SleeperRow[]) {
    const pos = POSITION_MAP[raw.player?.position ?? ''];
    if (!pos) continue;
    const stats = raw.stats ?? {};
    const points =
      stats[`pts_${suffix}`] ?? stats.pts_half_ppr ?? stats.pts_ppr ?? stats.pts_std ?? null;
    if (points === null || points === undefined || points <= 0) continue;
    const adpRaw =
      stats[`adp_${suffix}`] ?? stats.adp_half_ppr ?? stats.adp_ppr ?? stats.adp_std ?? null;
    const name = [raw.player?.first_name, raw.player?.last_name].filter(Boolean).join(' ').trim();
    if (!name || !raw.player_id) continue;

    const hasRealAdp = typeof adpRaw === 'number' && adpRaw > 0;
    const parsed = PlayerSchema.safeParse({
      playerId: `sleeper-${raw.player_id}`,
      name: pos === 'DST' && !name.includes(' ') ? `${name} DST` : name,
      team: raw.player?.team || 'FA',
      position: pos,
      projectedPoints: points,
      adp: hasRealAdp ? adpRaw : 999, // placeholder, replaced below
      injuryStatus: raw.player?.injury_status ?? undefined,
    });
    if (parsed.success) candidates.push({ player: parsed.data, hasRealAdp });
  }

  // Keep a draftable-size pool: everyone with a real ADP, plus the best of
  // the rest by points as late-draft depth with synthetic trailing ADPs.
  const withAdp = candidates.filter((c) => c.hasRealAdp).map((c) => c.player);
  const rest = candidates
    .filter((c) => !c.hasRealAdp)
    .map((c) => c.player)
    .sort((a, b) => b.projectedPoints - a.projectedPoints)
    .slice(0, Math.max(0, 350 - withAdp.length));
  const maxAdp = withAdp.reduce((m, p) => Math.max(m, p.adp), 0);
  rest.forEach((p, i) => {
    p.adp = maxAdp + 1 + i;
  });
  const players = [...withAdp, ...rest].sort((a, b) => a.adp - b.adp);

  if (players.length < 100) {
    throw new Error(
      `Sleeper returned only ${players.length} usable players. Projections for the season may not be published yet.`,
    );
  }
  if (withAdp.length < 100) {
    warnings.push('Sleeper ADP is sparse; late-round order is estimated from projections.');
  }
  return { players, sourceName: `Sleeper projections (${scoring.replace('_', ' ')})`, warnings };
}

export const sleeperSource: ProjectionSource = {
  id: 'sleeper',
  label: 'Sleeper',
  description: 'Live projections and ADP from the public Sleeper API.',
  availability: 'live',
  async fetchPlayers(scoring) {
    const season = currentSeason();
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
      .map((p) => `position[]=${p}`)
      .join('&');
    const url = `https://api.sleeper.com/projections/nfl/${season}?season_type=regular&${positions}&order_by=adp_${SCORING_SUFFIX[scoring]}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Sleeper API responded ${res.status}. Try again in a moment.`);
    }
    return parseSleeperRows(await res.json(), scoring);
  },
};
