import { describe, expect, it } from 'vitest';
import { PLAYER_POSITIONS, totalPicks } from '../src/config/league';
import { samplePlayers } from '../src/data/sampleData';
import { applyPick, createDraft } from '../src/draft/state';
import { recommend } from '../src/engine/recommend';
import { DEFAULT_STRATEGY } from '../src/strategy/presets';
import { league } from './fixtures';

describe('sample data', () => {
  it('parses cleanly and covers every position', () => {
    const players = samplePlayers();
    expect(players.length).toBeGreaterThan(150);
    for (const pos of PLAYER_POSITIONS) {
      expect(players.some((p) => p.position === pos)).toBe(true);
    }
  });

  it('supports a complete 12-team mock draft with recommendations at every user turn', () => {
    const cfg = league();
    expect(samplePlayers().length).toBeGreaterThanOrEqual(totalPicks(cfg));
    let s = createDraft(cfg, samplePlayers());
    while (!s.complete) {
      if (s.slotOnClock === cfg.userDraftSlot) {
        const rec = recommend(s, DEFAULT_STRATEGY);
        expect(rec.best).not.toBeNull();
        s = applyPick(s, rec.best!.player.playerId);
      } else {
        s = applyPick(s, s.availablePlayers[0]!.playerId);
      }
    }
    expect(s.picks.length).toBe(totalPicks(cfg));
  });
});
