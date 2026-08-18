import { PlayerSchema, type Player } from './player';

/**
 * Parse a projections CSV into players.
 *
 * Expected header (case-insensitive, order-free):
 *   name, team, position, projected_points, adp
 * Optional columns:
 *   player_id, adp_std_dev, rank, positional_rank, tier, injury_status, bye_week
 *
 * Returns players plus per-row errors so a bad row does not sink the import.
 */
export interface CsvImportResult {
  players: Player[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, string> = {
  player_id: 'playerId',
  id: 'playerId',
  name: 'name',
  player: 'name',
  team: 'team',
  position: 'position',
  pos: 'position',
  projected_points: 'projectedPoints',
  points: 'projectedPoints',
  proj: 'projectedPoints',
  fpts: 'projectedPoints',
  adp: 'adp',
  adp_std_dev: 'adpStdDev',
  adp_sd: 'adpStdDev',
  rank: 'rank',
  positional_rank: 'positionalRank',
  pos_rank: 'positionalRank',
  tier: 'tier',
  injury_status: 'injuryStatus',
  bye_week: 'byeWeek',
  bye: 'byeWeek',
};

const NUMERIC_FIELDS = new Set([
  'projectedPoints',
  'adp',
  'adpStdDev',
  'rank',
  'positionalRank',
  'tier',
  'byeWeek',
]);

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parsePlayersCsv(text: string): CsvImportResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    return { players: [], errors: ['CSV needs a header row and at least one player row.'] };
  }

  const headerCells = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().replace(/\s+/g, '_'));
  const fields = headerCells.map((h) => HEADER_ALIASES[h] ?? null);

  const required = ['name', 'team', 'position', 'projectedPoints', 'adp'];
  const missing = required.filter((r) => !fields.includes(r));
  if (missing.length > 0) {
    return { players: [], errors: [`CSV is missing required columns: ${missing.join(', ')}`] };
  }

  const players: Player[] = [];
  const errors: string[] = [];
  const seenIds = new Set<string>();

  for (let row = 1; row < lines.length; row++) {
    const cells = splitCsvLine(lines[row]!);
    const raw: Record<string, unknown> = {};
    for (let col = 0; col < fields.length; col++) {
      const field = fields[col];
      const value = cells[col];
      if (!field || value === undefined || value === '') continue;
      raw[field] = NUMERIC_FIELDS.has(field) ? Number(value) : value;
    }
    if (typeof raw.position === 'string') {
      const pos = raw.position.toUpperCase().replace(/^DEF$|^D\/ST$/, 'DST');
      raw.position = pos;
    }
    if (raw.playerId === undefined && typeof raw.name === 'string') {
      raw.playerId = `${raw.name}-${raw.position ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }
    const parsed = PlayerSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      errors.push(`Row ${row + 1}: ${first ? `${first.path.join('.')}: ${first.message}` : 'invalid'}`);
      continue;
    }
    if (seenIds.has(parsed.data.playerId)) {
      errors.push(`Row ${row + 1}: duplicate player id ${parsed.data.playerId}`);
      continue;
    }
    seenIds.add(parsed.data.playerId);
    players.push(parsed.data);
  }

  return { players, errors };
}
