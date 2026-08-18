import type { ScoringFormat } from '../../config/league';
import type { Player } from '../player';
import { espnSource } from './espn';
import { sleeperSource } from './sleeper';
import type { FetchedPlayers, ProjectionSource } from './types';
import { normalizePlayerKey } from './types';
import { yahooSource } from './yahoo';

/** Sources the aggregate tries, in priority order for tie-breaking names. */
const AGGREGATE_MEMBERS: ProjectionSource[] = [sleeperSource, espnSource];

export const ALL_SOURCES: ProjectionSource[] = [sleeperSource, espnSource, yahooSource];

/**
 * Merge players from several sources by name and position, averaging
 * projected points and ADP where more than one source knows the player.
 * Pure so it can be unit tested.
 */
export function mergeFetchedPlayers(results: FetchedPlayers[]): FetchedPlayers {
  if (results.length === 0) {
    throw new Error('No projection source responded.');
  }
  if (results.length === 1) return results[0]!;

  interface Merged {
    base: Player;
    points: number[];
    adps: number[];
  }
  const merged = new Map<string, Merged>();
  for (const result of results) {
    for (const player of result.players) {
      const key = normalizePlayerKey(player.name, player.position);
      const existing = merged.get(key);
      if (existing) {
        existing.points.push(player.projectedPoints);
        existing.adps.push(player.adp);
        existing.base = {
          ...existing.base,
          injuryStatus: existing.base.injuryStatus ?? player.injuryStatus,
        };
      } else {
        merged.set(key, {
          base: { ...player, playerId: `agg-${key}` },
          points: [player.projectedPoints],
          adps: [player.adp],
        });
      }
    }
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const players = [...merged.values()]
    .map((m) => ({
      ...m.base,
      projectedPoints: Math.round(avg(m.points) * 10) / 10,
      adp: Math.round(avg(m.adps) * 10) / 10,
    }))
    .sort((a, b) => a.adp - b.adp);

  const names = results.map((r) => r.sourceName.split(' ')[0]).join(' + ');
  return {
    players,
    sourceName: `Aggregate (${names})`,
    warnings: results.flatMap((r) => r.warnings),
  };
}

export const aggregateSource: ProjectionSource = {
  id: 'aggregate',
  label: 'Aggregate (all)',
  description: 'Averages projections and ADP across every source that responds.',
  availability: 'live',
  async fetchPlayers(scoring: ScoringFormat) {
    const settled = await Promise.allSettled(
      AGGREGATE_MEMBERS.map((s) => s.fetchPlayers(scoring)),
    );
    const successes: FetchedPlayers[] = [];
    const failures: string[] = [];
    settled.forEach((outcome, i) => {
      if (outcome.status === 'fulfilled') successes.push(outcome.value);
      else {
        failures.push(
          `${AGGREGATE_MEMBERS[i]!.label}: ${outcome.reason instanceof Error ? outcome.reason.message : outcome.reason}`,
        );
      }
    });
    if (successes.length === 0) {
      throw new Error(`No source responded. ${failures.join(' ')}`);
    }
    const merged = mergeFetchedPlayers(successes);
    if (failures.length > 0) {
      merged.warnings.push(...failures.map((f) => `Skipped ${f}`));
    }
    return merged;
  },
};
