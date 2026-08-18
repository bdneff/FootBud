import { describe, expect, it } from 'vitest';
import { parsePlayersCsv } from '../src/data/importCsv';

describe('CSV import', () => {
  it('parses a well-formed file with aliases and quoting', () => {
    const csv = [
      'Name,Team,Pos,FPTS,ADP,Bye',
      '"Smith, John",BUF,RB,280.5,3.2,12',
      'Jane Receiver,DAL,WR,240,10.8,7',
      'Big Defense,SF,D/ST,120,140,9',
    ].join('\n');
    const { players, errors } = parsePlayersCsv(csv);
    expect(errors).toEqual([]);
    expect(players.length).toBe(3);
    expect(players[0]!.name).toBe('Smith, John');
    expect(players[0]!.projectedPoints).toBe(280.5);
    expect(players[2]!.position).toBe('DST');
  });

  it('reports missing required columns', () => {
    const { players, errors } = parsePlayersCsv('name,team\nJohn,BUF');
    expect(players.length).toBe(0);
    expect(errors[0]).toMatch(/missing required/);
  });

  it('skips bad rows without sinking the import', () => {
    const csv = ['name,team,position,points,adp', 'Good RB,BUF,RB,200,5', 'Bad Row,BUF,XX,200,5'].join(
      '\n',
    );
    const { players, errors } = parsePlayersCsv(csv);
    expect(players.length).toBe(1);
    expect(errors.length).toBe(1);
  });

  it('rejects out-of-bounds values instead of clamping', () => {
    const csv = ['name,team,position,points,adp', 'Neg Points,BUF,RB,-5,5'].join('\n');
    const { players, errors } = parsePlayersCsv(csv);
    expect(players.length).toBe(0);
    expect(errors.length).toBe(1);
  });
});
