import { describe, expect, it } from 'vitest';
import { totalPicks } from '../src/config/league';
import {
  applyPick,
  createDraft,
  restoreDraft,
  serializeDraft,
  undoPick,
  userRoster,
} from '../src/draft/state';
import { league, syntheticPool } from './fixtures';

describe('draft state transitions', () => {
  it('starts at pick 1 with the full pool available', () => {
    const s = createDraft(league(), syntheticPool());
    expect(s.currentPick).toBe(1);
    expect(s.currentRound).toBe(1);
    expect(s.slotOnClock).toBe(1);
    expect(s.availablePlayers.length).toBe(syntheticPool().length);
    expect(s.nextUserPick).toBe(1);
    expect(s.picksUntilUserPick).toBe(0);
  });

  it('removes drafted players from availability', () => {
    let s = createDraft(league(), syntheticPool());
    s = applyPick(s, 'rb1');
    expect(s.availablePlayers.some((p) => p.playerId === 'rb1')).toBe(false);
    expect(() => applyPick(s, 'rb1')).toThrow(/already drafted/);
  });

  it('assigns picks to the roster of the team on the clock', () => {
    let s = createDraft(league({ numberOfTeams: 12, userDraftSlot: 1 }), syntheticPool());
    s = applyPick(s, 'rb1'); // slot 1
    s = applyPick(s, 'wr1'); // slot 2
    expect(s.rosters[0]!.players.map((p) => p.playerId)).toEqual(['rb1']);
    expect(s.rosters[1]!.players.map((p) => p.playerId)).toEqual(['wr1']);
    expect(userRoster(s).countsByPosition.RB).toBe(1);
  });

  it('tracks the user turn correctly around the wheel', () => {
    let s = createDraft(league({ numberOfTeams: 12, userDraftSlot: 1 }), syntheticPool());
    s = applyPick(s, 'rb1');
    expect(s.currentPick).toBe(2);
    expect(s.nextUserPick).toBe(24);
    expect(s.picksUntilUserPick).toBe(22);
    expect(s.userPickAfterNext).toBe(25);
  });

  it('undo restores availability, rosters, and clock', () => {
    let s = createDraft(league(), syntheticPool());
    s = applyPick(s, 'rb1');
    s = applyPick(s, 'wr1');
    s = undoPick(s);
    expect(s.currentPick).toBe(2);
    expect(s.availablePlayers.some((p) => p.playerId === 'wr1')).toBe(true);
    expect(s.rosters[1]!.players.length).toBe(0);
    s = undoPick(s);
    expect(s.currentPick).toBe(1);
    expect(s.rosters[0]!.players.length).toBe(0);
    // Undo on an empty draft is a no-op.
    expect(undoPick(s).currentPick).toBe(1);
  });

  it('survives a complete mock draft and then refuses further picks', () => {
    const cfg = league();
    let s = createDraft(cfg, syntheticPool());
    const total = totalPicks(cfg);
    for (let i = 0; i < total; i++) {
      s = applyPick(s, s.availablePlayers[0]!.playerId);
    }
    expect(s.complete).toBe(true);
    expect(s.currentPick).toBeNull();
    expect(s.picks.length).toBe(total);
    for (const roster of s.rosters) {
      expect(roster.players.length).toBe(total / cfg.numberOfTeams);
    }
    expect(() => applyPick(s, s.availablePlayers[0]!.playerId)).toThrow(/complete/);
  });

  it('round-trips through serialize/restore', () => {
    let s = createDraft(league(), syntheticPool());
    s = applyPick(s, 'rb1');
    s = applyPick(s, 'wr1');
    const restored = restoreDraft(serializeDraft(s, '2026-08-18T00:00:00Z'));
    expect(restored.currentPick).toBe(3);
    expect(restored.picks).toEqual(s.picks);
    expect(restored.availablePlayers.length).toBe(s.availablePlayers.length);
  });
});
