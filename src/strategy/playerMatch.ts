import type { Player } from '../data/player';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a human-typed player name against the pool. Exact normalized match
 * first; otherwise a unique last-name or substring match. Ambiguous names
 * (two players share the token) resolve to null rather than guessing.
 */
export function matchPlayerByName(players: Iterable<Player>, name: string): Player | null {
  const q = normalize(name);
  if (q === '') return null;
  const all = [...players];

  const exact = all.filter((p) => normalize(p.name) === q);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;

  const byToken = all.filter((p) => {
    const norm = normalize(p.name);
    return norm.split(' ').includes(q) || norm.includes(q);
  });
  if (byToken.length === 1) return byToken[0]!;

  // Defense names vary by platform ("Bears DST" vs "Chicago Bears"): retry
  // with the DST suffix dropped so the nickname token can match.
  if (/\bdst$/.test(q)) {
    const nickname = q.replace(/\s*dst$/, '').trim();
    if (nickname && nickname !== q) return matchPlayerByName(all, nickname);
  }
  return null;
}

/** Map playerId -> stance for every note that resolves to a real player. */
export function resolvePlayerNotes(
  players: Iterable<Player>,
  notes: { name: string; stance: 'target' | 'avoid' }[],
): Map<string, 'target' | 'avoid'> {
  const out = new Map<string, 'target' | 'avoid'>();
  const all = [...players];
  for (const note of notes) {
    const player = matchPlayerByName(all, note.name);
    if (player) out.set(player.playerId, note.stance);
  }
  return out;
}
