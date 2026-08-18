import type { ScoringFormat } from '../../config/league';
import type { Player } from '../player';

export interface FetchedPlayers {
  players: Player[];
  sourceName: string;
  warnings: string[];
}

/**
 * A place player projections and ADP come from. Everything behind this
 * interface: the rest of the app never knows whether players came from an
 * API, a CSV, or bundled sample data.
 *
 * availability:
 * - 'live': works from the browser today.
 * - 'blocked': a real endpoint exists but the provider does not allow
 *   browser apps to call it (no CORS). We still try, and fail with an
 *   explanation.
 * - 'unavailable': needs a server (OAuth etc.) FootBud does not have yet.
 */
export interface ProjectionSource {
  id: string;
  label: string;
  description: string;
  availability: 'live' | 'blocked' | 'unavailable';
  fetchPlayers(scoring: ScoringFormat): Promise<FetchedPlayers>;
}

/** NFL season for a given date: the season year flips in the spring. */
export function currentSeason(now: Date = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() >= 3 ? year : year - 1; // April or later -> this year's season
}

export function normalizePlayerKey(name: string, position: string): string {
  return `${position}:${name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '')}`;
}
