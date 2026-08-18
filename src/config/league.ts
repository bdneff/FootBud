import { z } from 'zod';

/** Positions a player can have. FLEX/SUPERFLEX/BENCH are roster slots, not player positions. */
export const PLAYER_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const;
export type Position = (typeof PLAYER_POSITIONS)[number];

export const FLEX_ELIGIBLE: readonly Position[] = ['RB', 'WR', 'TE'];
export const SUPERFLEX_ELIGIBLE: readonly Position[] = ['QB', 'RB', 'WR', 'TE'];

export type DraftType = 'snake' | 'linear';
export type ScoringFormat = 'standard' | 'half_ppr' | 'ppr';

export const RosterConfigSchema = z.object({
  QB: z.number().int().min(0).max(4),
  RB: z.number().int().min(0).max(8),
  WR: z.number().int().min(0).max(8),
  TE: z.number().int().min(0).max(4),
  FLEX: z.number().int().min(0).max(4),
  SUPERFLEX: z.number().int().min(0).max(2),
  K: z.number().int().min(0).max(2),
  DST: z.number().int().min(0).max(2),
  BENCH: z.number().int().min(0).max(12),
});
export type RosterConfig = z.infer<typeof RosterConfigSchema>;

export const LeagueConfigSchema = z
  .object({
    leagueName: z.string().min(1),
    numberOfTeams: z.number().int().min(4).max(20),
    draftType: z.enum(['snake', 'linear']),
    userDraftSlot: z.number().int().min(1),
    scoringFormat: z.enum(['standard', 'half_ppr', 'ppr']),
    roster: RosterConfigSchema,
  })
  .refine((c) => c.userDraftSlot <= c.numberOfTeams, {
    message: 'userDraftSlot must be <= numberOfTeams',
  });
export type LeagueConfig = z.infer<typeof LeagueConfigSchema>;

/** Total roster spots each team drafts. */
export function rosterSize(roster: RosterConfig): number {
  return (
    roster.QB +
    roster.RB +
    roster.WR +
    roster.TE +
    roster.FLEX +
    roster.SUPERFLEX +
    roster.K +
    roster.DST +
    roster.BENCH
  );
}

/** Number of starting (non-bench) slots. */
export function starterCount(roster: RosterConfig): number {
  return rosterSize(roster) - roster.BENCH;
}

export function totalPicks(config: LeagueConfig): number {
  return config.numberOfTeams * rosterSize(config.roster);
}

export const DEFAULT_ROSTER: RosterConfig = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  SUPERFLEX: 0,
  K: 1,
  DST: 1,
  BENCH: 6,
};

/** The default league from the build plan: 12-team snake from the 1.01, half PPR. */
export const DEFAULT_LEAGUE: LeagueConfig = {
  leagueName: 'My League',
  numberOfTeams: 12,
  draftType: 'snake',
  userDraftSlot: 1,
  scoringFormat: 'half_ppr',
  roster: DEFAULT_ROSTER,
};
