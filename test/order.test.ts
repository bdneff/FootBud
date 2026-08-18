import { describe, expect, it } from 'vitest';
import { picksForSlot, slotOnClock } from '../src/draft/order';
import { league } from './fixtures';

describe('snake draft order', () => {
  it('gives slot 1 of 12 the picks 1, 24, 25, 48, 49, 72, 73', () => {
    const picks = picksForSlot(league({ numberOfTeams: 12, userDraftSlot: 1 }), 1);
    expect(picks.slice(0, 7)).toEqual([1, 24, 25, 48, 49, 72, 73]);
  });

  it('gives slot 12 of 12 the turn picks 12, 13, 36, 37', () => {
    const picks = picksForSlot(league({ numberOfTeams: 12 }), 12);
    expect(picks.slice(0, 4)).toEqual([12, 13, 36, 37]);
  });

  it('gives a middle slot alternating gaps', () => {
    const picks = picksForSlot(league({ numberOfTeams: 12 }), 5);
    expect(picks.slice(0, 4)).toEqual([5, 20, 29, 44]);
  });

  it('handles a 10-team league', () => {
    const cfg = league({ numberOfTeams: 10, userDraftSlot: 3 });
    expect(picksForSlot(cfg, 3).slice(0, 4)).toEqual([3, 18, 23, 38]);
  });

  it('reverses even rounds only in snake', () => {
    expect(slotOnClock(13, 12, 'snake')).toBe(12);
    expect(slotOnClock(24, 12, 'snake')).toBe(1);
    expect(slotOnClock(25, 12, 'snake')).toBe(1);
  });

  it('never reverses in linear drafts', () => {
    const cfg = league({ draftType: 'linear', numberOfTeams: 12 });
    expect(picksForSlot(cfg, 1).slice(0, 3)).toEqual([1, 13, 25]);
    expect(slotOnClock(13, 12, 'linear')).toBe(1);
    expect(slotOnClock(24, 12, 'linear')).toBe(12);
  });
});
