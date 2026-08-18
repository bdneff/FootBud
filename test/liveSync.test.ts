import { describe, expect, it } from 'vitest';
import { extractDraftId, parseSleeperDraft, parseSleeperPicks } from '../src/draft/sources/sleeper';
import { buildSyncedDraft } from '../src/draft/sources/sync';
import type { ExternalPick } from '../src/draft/sources/types';
import { samplePlayers } from '../src/data/sampleData';
import { rosterSize } from '../src/config/league';
import { league } from './fixtures';

const SLEEPER_DRAFT = {
  draft_id: '1234567890',
  type: 'snake',
  status: 'drafting',
  start_time: 1756000000000,
  metadata: { name: 'The Boys League', scoring_type: 'half_ppr' },
  settings: {
    teams: 10,
    rounds: 15,
    slots_qb: 1,
    slots_rb: 2,
    slots_wr: 3,
    slots_te: 1,
    slots_flex: 1,
    slots_super_flex: 0,
    slots_k: 1,
    slots_def: 1,
    slots_bn: 4,
  },
  draft_order: { user123: 7 },
};

describe('Sleeper draft parsing', () => {
  it('maps settings to a league config and finds the user slot', () => {
    const info = parseSleeperDraft(SLEEPER_DRAFT, 'user123');
    expect(info.config.numberOfTeams).toBe(10);
    expect(info.config.draftType).toBe('snake');
    expect(info.config.scoringFormat).toBe('half_ppr');
    expect(info.config.roster.WR).toBe(3);
    expect(info.userSlot).toBe(7);
    // Roster size tracks rounds so the draft ends when Sleeper's does.
    expect(rosterSize(info.config.roster)).toBe(15);
  });

  it('pads the bench when slots do not add up to rounds', () => {
    const info = parseSleeperDraft(
      { ...SLEEPER_DRAFT, settings: { ...SLEEPER_DRAFT.settings, rounds: 18 } },
      null,
    );
    expect(rosterSize(info.config.roster)).toBe(18);
  });

  it('rejects auction drafts with a clear message', () => {
    expect(() => parseSleeperDraft({ ...SLEEPER_DRAFT, type: 'auction' }, null)).toThrow(/auction/);
  });

  it('extracts draft ids from URLs and bare ids', () => {
    expect(extractDraftId('https://sleeper.com/draft/nfl/1146715983423512576')).toBe(
      '1146715983423512576',
    );
    expect(extractDraftId('1146715983423512576')).toBe('1146715983423512576');
    expect(extractDraftId('myusername')).toBeNull();
  });

  it('parses pick rows sorted by pick number', () => {
    const picks = parseSleeperPicks([
      {
        pick_no: 2,
        draft_slot: 2,
        player_id: '9509',
        metadata: { first_name: 'Bijan', last_name: 'Robinson', position: 'RB', team: 'ATL' },
      },
      {
        pick_no: 1,
        draft_slot: 1,
        player_id: '7564',
        metadata: { first_name: "Ja'Marr", last_name: 'Chase', position: 'WR', team: 'CIN' },
      },
      { pick_no: 3, metadata: {} }, // nameless row skipped
    ]);
    expect(picks.map((p) => p.playerName)).toEqual(["Ja'Marr Chase", 'Bijan Robinson']);
    expect(picks[0]!.externalPlayerId).toBe('7564');
  });
});

describe('synced draft building', () => {
  const cfg = league({ userDraftSlot: 1 });

  const pick = (overall: number, name: string, position: ExternalPick['position']): ExternalPick => ({
    overall,
    slot: 0,
    playerName: name,
    position,
    team: null,
    externalPlayerId: null,
  });

  it('matches picks by name against the loaded pool', () => {
    const { state, ghostPlayers } = buildSyncedDraft(cfg, samplePlayers(), [
      pick(1, "Ja'Marr Chase", 'WR'),
      pick(2, 'Bijan Robinson', 'RB'),
    ]);
    expect(ghostPlayers).toEqual([]);
    expect(state.picks.length).toBe(2);
    expect(state.currentPick).toBe(3);
    expect(state.availablePlayers.some((p) => p.name === "Ja'Marr Chase")).toBe(false);
    expect(state.rosters[0]!.players[0]!.name).toBe("Ja'Marr Chase");
  });

  it('matches by platform id when the pool came from the same platform', () => {
    const pool = samplePlayers().map((p, i) =>
      i === 0 ? { ...p, playerId: 'sleeper-7564' } : p,
    );
    const external: ExternalPick = { ...pick(1, 'J. Chase', 'WR'), externalPlayerId: '7564' };
    const { state, ghostPlayers } = buildSyncedDraft(cfg, pool, [external]);
    expect(ghostPlayers).toEqual([]);
    expect(state.picks[0]!.playerId).toBe('sleeper-7564');
  });

  it('creates placeholders for players missing from projections', () => {
    const { state, ghostPlayers, warnings } = buildSyncedDraft(cfg, samplePlayers(), [
      pick(1, 'Totally Unknown Rookie', 'RB'),
    ]);
    expect(ghostPlayers).toEqual(['Totally Unknown Rookie']);
    expect(warnings.length).toBeGreaterThan(0);
    const ghost = state.pool.get(state.picks[0]!.playerId)!;
    expect(ghost.projectedPoints).toBe(0);
    expect(state.rosters[0]!.players[0]!.name).toBe('Totally Unknown Rookie');
  });

  it('honors traded-pick slot overrides in roster assignment', () => {
    const traded: ExternalPick = { ...pick(1, "Ja'Marr Chase", 'WR'), slot: 5 };
    const { state } = buildSyncedDraft(cfg, samplePlayers(), [traded]);
    expect(state.rosters[4]!.players[0]!.name).toBe("Ja'Marr Chase");
    expect(state.rosters[0]!.players.length).toBe(0);
  });

  it('is a pure rebuild: absorbing a platform-side correction', () => {
    const players = samplePlayers();
    const first = buildSyncedDraft(cfg, players, [
      pick(1, "Ja'Marr Chase", 'WR'),
      pick(2, 'Bijan Robinson', 'RB'),
    ]);
    // Sleeper undoes pick 2 and it becomes someone else.
    const corrected = buildSyncedDraft(cfg, players, [
      pick(1, "Ja'Marr Chase", 'WR'),
      pick(2, 'Saquon Barkley', 'RB'),
    ]);
    expect(first.state.picks[1]!.playerId).not.toBe(corrected.state.picks[1]!.playerId);
    expect(corrected.state.availablePlayers.some((p) => p.name === 'Bijan Robinson')).toBe(true);
  });
});
