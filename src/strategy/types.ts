import { z } from 'zod';
import { PLAYER_POSITIONS } from '../config/league';

/**
 * A DraftStrategy is a structured policy layered on top of the quantitative
 * engine. Weights shape the score; priorities and rules apply conditional
 * adjustments. This schema is also the target format for the future AI
 * strategy builder: natural language and uploaded documents get translated
 * into this object, never directly into recommendations.
 */

export const PositionPrioritySchema = z.enum(['high', 'normal', 'patient', 'avoid']);
export type PositionPriority = z.infer<typeof PositionPrioritySchema>;

export const StrategyWeightsSchema = z.object({
  /** Raw projected production. */
  projection: z.number().min(0).max(1),
  /** Value over replacement. */
  vor: z.number().min(0).max(1),
  /** Positional scarcity / tier drop-off (cost of waiting). */
  scarcity: z.number().min(0).max(1),
  /** Urgency from survival probability: valuable players unlikely to return. */
  survival: z.number().min(0).max(1),
  /** Fit with current roster needs. */
  rosterNeed: z.number().min(0).max(1),
  /** Value versus market (falling below ADP). */
  upside: z.number().min(0).max(1),
});
export type StrategyWeights = z.infer<typeof StrategyWeightsSchema>;

export const StrategyRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('avoidPositionBefore'),
    position: z.enum(PLAYER_POSITIONS),
    /** Do not draft this position before this round... */
    round: z.number().int().min(1),
    /** ...unless the player's VOR beats the best other-position VOR by this margin. */
    exceptionVorAdvantage: z.number().min(0).optional(),
    /** Multiplier applied to the score while the rule is active (0..1). */
    penalty: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal('limitPosition'),
    position: z.enum(PLAYER_POSITIONS),
    /** Hard cap on how many of this position to roster. */
    max: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('boostPositionRounds'),
    position: z.enum(PLAYER_POSITIONS),
    fromRound: z.number().int().min(1),
    toRound: z.number().int().min(1),
    /** Multiplier > 1 boosts, < 1 dampens, within the round window. */
    multiplier: z.number().min(0.25).max(2),
  }),
]);
export type StrategyRule = z.infer<typeof StrategyRuleSchema>;

export const DraftStrategySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  weights: StrategyWeightsSchema,
  positionPriorities: z.record(z.enum(PLAYER_POSITIONS), PositionPrioritySchema),
  rules: z.array(StrategyRuleSchema),
  riskTolerance: z.enum(['conservative', 'balanced', 'aggressive']),
});
export type DraftStrategy = z.infer<typeof DraftStrategySchema>;

export const PRIORITY_MULTIPLIER: Record<PositionPriority, number> = {
  high: 1.06,
  normal: 1.0,
  patient: 0.9,
  avoid: 0.72,
};
