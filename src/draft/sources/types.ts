import type { LeagueConfig, Position } from '../../config/league';

/**
 * Live draft sources: places picks arrive from during a real draft. The
 * decision engine never sees these types; external picks get translated
 * into ordinary DraftState transitions.
 */

export interface ExternalDraftInfo {
  draftId: string;
  name: string;
  status: 'pre_draft' | 'drafting' | 'paused' | 'complete';
  /** Start time in ms since epoch, when known. */
  startTime: number | null;
  /** League config derived from the platform's draft settings. */
  config: Omit<LeagueConfig, 'userDraftSlot'>;
  /** The connecting user's slot, when the platform tells us. */
  userSlot: number | null;
}

export interface ExternalPick {
  /** 1-indexed overall pick number. */
  overall: number;
  /** Slot that actually made the pick (traded picks differ from snake math). */
  slot: number;
  playerName: string;
  position: Position | null;
  team: string | null;
  /** Platform's player id, used for exact matching when available. */
  externalPlayerId: string | null;
}

export interface LiveDraftSource {
  id: string;
  label: string;
  /** Find a user's drafts from a username or id; defaults to the current season. */
  findDrafts(usernameOrId: string, season?: number): Promise<ExternalDraftInfo[]>;
  fetchDraft(draftId: string): Promise<ExternalDraftInfo>;
  fetchPicks(draftId: string): Promise<ExternalPick[]>;
}
