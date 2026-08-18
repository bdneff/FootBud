import type { LeagueConfig } from '../config/league';
import type { Player } from '../data/player';
import type { DraftStrategy } from '../strategy/types';
import type { AiStrategyOutput } from './schemas';

/** One turn in the strategy-builder conversation. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StrategyDocument {
  fileName: string;
  /** 'text' covers .txt and .md; 'pdf' is base64 without newlines. */
  kind: 'text' | 'pdf';
  data: string;
}

export interface InterviewInput {
  config: LeagueConfig;
  turns: ChatTurn[];
}

export interface FinalizeInput {
  config: LeagueConfig;
  players: Player[];
  /** Interview transcript, freeform description, or extracted document text. */
  turns?: ChatTurn[];
  document?: StrategyDocument;
}

/**
 * Provider abstraction so the app is not tied to one model vendor. The
 * provider translates language into structured strategies and explains the
 * engine's numbers; it never computes draft math itself.
 */
export interface AIProvider {
  /** Next assistant message in the guided strategy interview. Streams tokens. */
  interviewTurn(input: InterviewInput, onToken: (text: string) => void): Promise<string>;
  /** Turn a transcript or uploaded document into a structured strategy. */
  interpretStrategy(input: FinalizeInput): Promise<AiStrategyOutput>;
  /** Apply a plain-language modification to an existing strategy. */
  modifyStrategy(
    config: LeagueConfig,
    players: Player[],
    strategy: DraftStrategy,
    instruction: string,
  ): Promise<AiStrategyOutput>;
  /** Answer an in-draft question grounded in the engine snapshot. Streams tokens. */
  askDraftQuestion(
    snapshot: unknown,
    history: ChatTurn[],
    question: string,
    onToken: (text: string) => void,
  ): Promise<string>;
}
