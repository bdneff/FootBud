import type { LeagueConfig } from '../../config/league';
import type { Player } from '../../data/player';
import { matchPlayerByName } from '../../strategy/playerMatch';
import { applyPick, createDraft, type DraftState } from '../state';
import type { ExternalPick } from './types';

export interface SyncResult {
  state: DraftState;
  /** Names that had to be added as placeholder players. */
  ghostPlayers: string[];
  warnings: string[];
}

/**
 * Rebuild a DraftState from the authoritative external pick list. Rebuilt
 * from scratch every poll: it is cheap, and it means corrections on the
 * platform (undone picks, commissioner fixes) are absorbed automatically.
 *
 * Matching order: platform player id (works when the pool was loaded from
 * the same platform), then name+position, then name alone. Players we have
 * no projections for become zero-point placeholders so rosters and the
 * board stay accurate.
 */
export function buildSyncedDraft(
  config: LeagueConfig,
  players: Player[],
  externalPicks: ExternalPick[],
): SyncResult {
  const warnings: string[] = [];
  const ghostPlayers: string[] = [];
  const pool = [...players];
  const byExternalId = new Map<string, Player>();
  for (const p of pool) {
    const m = p.playerId.match(/^sleeper-(.+)$/);
    if (m) byExternalId.set(m[1]!, p);
  }
  const taken = new Set<string>();

  const resolved: { pick: ExternalPick; player: Player }[] = [];
  for (const pick of externalPicks) {
    let player: Player | null = null;
    if (pick.externalPlayerId) player = byExternalId.get(pick.externalPlayerId) ?? null;
    if (!player) {
      const pos = pick.position;
      const candidates = pos ? pool.filter((p) => p.position === pos) : pool;
      player = matchPlayerByName(candidates, pick.playerName) ?? matchPlayerByName(pool, pick.playerName);
    }
    if (player && taken.has(player.playerId)) {
      warnings.push(`${pick.playerName} matched a player already drafted; added as a placeholder.`);
      player = null;
    }
    if (!player) {
      // Placeholder so the board and rosters stay truthful even without
      // projections. Zero points keeps the engine from ever valuing it.
      player = {
        playerId: `ext-${pick.overall}-${pick.playerName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: pick.playerName,
        team: pick.team ?? 'FA',
        position: pick.position ?? 'WR',
        projectedPoints: 0,
        adp: pick.overall,
      };
      pool.push(player);
      ghostPlayers.push(pick.playerName);
    }
    taken.add(player.playerId);
    resolved.push({ pick, player });
  }

  let state = createDraft(config, pool);
  for (const { pick, player } of resolved) {
    if (state.complete) {
      warnings.push('The platform reported more picks than this league drafts; extra picks ignored.');
      break;
    }
    if (state.currentPick !== pick.overall) {
      // A gap in pick numbers (skipped/voided pick). Keep going by order.
      warnings.push(`Pick numbering gap at ${pick.overall}; applying picks in order.`);
    }
    state = applyPick(state, player.playerId, pick.slot >= 1 ? pick.slot : undefined);
  }

  if (ghostPlayers.length > 0) {
    warnings.push(
      `${ghostPlayers.length} drafted player(s) were not in your projections and were added as placeholders.`,
    );
  }
  return { state, ghostPlayers, warnings };
}
