import type { LeagueConfig, Position } from '../../config/league';
import { currentSeason } from '../../data/sources/types';
import type { ExternalDraftInfo, ExternalPick, LiveDraftSource } from './types';

/**
 * Sleeper live drafts. Public, unauthenticated, CORS-open API:
 *   /v1/user/{username}                -> user_id
 *   /v1/user/{user_id}/drafts/nfl/{yr} -> the user's drafts
 *   /v1/draft/{draft_id}               -> settings, order, status
 *   /v1/draft/{draft_id}/picks         -> picks so far
 */

const BASE = 'https://api.sleeper.app/v1';

const POSITION_MAP: Record<string, Position> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DST',
};

interface SleeperDraft {
  draft_id?: string;
  type?: string; // snake | linear | auction
  status?: string;
  start_time?: number | null;
  metadata?: { name?: string; scoring_type?: string };
  settings?: Record<string, number | undefined>;
  /** user_id -> draft slot */
  draft_order?: Record<string, number> | null;
}

interface SleeperPickRow {
  pick_no?: number;
  draft_slot?: number;
  player_id?: string;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
}

/** "https://sleeper.com/draft/nfl/123..." | "123..." -> "123..." */
export function extractDraftId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/draft\/nfl\/(\d+)/i);
  if (urlMatch) return urlMatch[1]!;
  if (/^\d{8,}$/.test(trimmed)) return trimmed;
  return null;
}

function scoringFromSleeper(scoring: string | undefined): LeagueConfig['scoringFormat'] {
  if (scoring === 'ppr') return 'ppr';
  if (scoring === 'std' || scoring === 'standard') return 'standard';
  return 'half_ppr';
}

/** Pure so it can be unit tested. userId lets us read the user's slot. */
export function parseSleeperDraft(raw: unknown, userId: string | null): ExternalDraftInfo {
  const d = raw as SleeperDraft;
  if (!d?.draft_id) throw new Error('Sleeper returned an unexpected draft shape.');
  if (d.type === 'auction') {
    throw new Error('This is an auction draft. FootBud only supports snake and linear drafts.');
  }
  const s = d.settings ?? {};
  const teams = s.teams ?? 12;
  const roster = {
    QB: s.slots_qb ?? 1,
    RB: s.slots_rb ?? 2,
    WR: s.slots_wr ?? 2,
    TE: s.slots_te ?? 1,
    FLEX: s.slots_flex ?? 1,
    SUPERFLEX: s.slots_super_flex ?? 0,
    K: s.slots_k ?? 1,
    DST: s.slots_def ?? 1,
    BENCH: s.slots_bn ?? 6,
  };
  // The draft runs for settings.rounds picks per team; keep our roster size
  // in lockstep so the draft completes at the same pick Sleeper's does.
  const rounds = s.rounds;
  if (rounds !== undefined) {
    const sum = Object.values(roster).reduce((a, b) => a + b, 0);
    roster.BENCH = Math.max(0, roster.BENCH + (rounds - sum));
  }
  const status = (['pre_draft', 'drafting', 'paused', 'complete'] as const).includes(
    d.status as never,
  )
    ? (d.status as ExternalDraftInfo['status'])
    : 'drafting';
  return {
    draftId: d.draft_id,
    name: d.metadata?.name || 'Sleeper draft',
    status,
    startTime: d.start_time ?? null,
    config: {
      leagueName: d.metadata?.name || 'Sleeper draft',
      numberOfTeams: teams,
      draftType: d.type === 'linear' ? 'linear' : 'snake',
      scoringFormat: scoringFromSleeper(d.metadata?.scoring_type),
      roster,
    },
    userSlot: userId && d.draft_order ? (d.draft_order[userId] ?? null) : null,
  };
}

/** Pure so it can be unit tested. */
export function parseSleeperPicks(raw: unknown): ExternalPick[] {
  if (!Array.isArray(raw)) throw new Error('Sleeper returned an unexpected picks shape.');
  const picks: ExternalPick[] = [];
  for (const row of raw as SleeperPickRow[]) {
    if (typeof row.pick_no !== 'number' || row.pick_no < 1) continue;
    const first = row.metadata?.first_name ?? '';
    const last = row.metadata?.last_name ?? '';
    const name = `${first} ${last}`.trim();
    if (!name) continue;
    const position = POSITION_MAP[row.metadata?.position ?? ''] ?? null;
    picks.push({
      overall: row.pick_no,
      slot: typeof row.draft_slot === 'number' && row.draft_slot >= 1 ? row.draft_slot : 0,
      playerName: position === 'DST' && !name.includes(' ') ? `${name} DST` : name,
      position,
      team: row.metadata?.team ?? null,
      externalPlayerId: row.player_id ?? null,
    });
  }
  picks.sort((a, b) => a.overall - b.overall);
  return picks;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Not found on Sleeper. Check the name or id.');
  if (!res.ok) throw new Error(`Sleeper API responded ${res.status}.`);
  return res.json();
}

export const sleeperDraftSource: LiveDraftSource = {
  id: 'sleeper',
  label: 'Sleeper',

  async findDrafts(usernameOrId: string, season = currentSeason()): Promise<ExternalDraftInfo[]> {
    // A pasted draft URL or bare draft id skips the username lookup.
    const directId = extractDraftId(usernameOrId);
    if (directId) {
      return [await this.fetchDraft(directId)];
    }
    const user = (await getJson(`${BASE}/user/${encodeURIComponent(usernameOrId.trim())}`)) as {
      user_id?: string;
    };
    if (!user?.user_id) throw new Error('Sleeper user not found.');
    const drafts = (await getJson(`${BASE}/user/${user.user_id}/drafts/nfl/${season}`)) as unknown[];
    if (!Array.isArray(drafts) || drafts.length === 0) {
      throw new Error(`No ${season} drafts found for that Sleeper user.`);
    }
    return drafts.map((d) => parseSleeperDraft(d, user.user_id!));
  },

  async fetchDraft(draftId: string): Promise<ExternalDraftInfo> {
    return parseSleeperDraft(await getJson(`${BASE}/draft/${draftId}`), null);
  },

  async fetchPicks(draftId: string): Promise<ExternalPick[]> {
    return parseSleeperPicks(await getJson(`${BASE}/draft/${draftId}/picks`));
  },
};
