// zod/v4: the Anthropic SDK's zodOutputFormat helper requires zod v4 schemas.
// The rest of the app stays on the v3 API; both ship in the zod package.
import { z } from 'zod/v4';
import { PLAYER_POSITIONS } from '../config/league';
import {
  DraftStrategySchema,
  type DraftStrategy,
  type PositionPriority,
} from '../strategy/types';

/**
 * Schema for what the model returns when building or modifying a strategy.
 * Kept separate from DraftStrategySchema: structured outputs want every field
 * required (nullable instead of optional) and explicit keys instead of
 * records, and the model's numbers get clamped and validated before they
 * become a real DraftStrategy. The engine only ever consumes the validated
 * DraftStrategy, never raw model output.
 */

const PrioritySchema = z.enum(['high', 'normal', 'patient', 'avoid']);

const AiRuleSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('avoidPositionBefore'),
    position: z.enum(PLAYER_POSITIONS),
    round: z.number(),
    exceptionVorAdvantage: z.number().nullable(),
    penalty: z.number(),
  }),
  z.object({
    type: z.literal('limitPosition'),
    position: z.enum(PLAYER_POSITIONS),
    max: z.number(),
  }),
  z.object({
    type: z.literal('boostPositionRounds'),
    position: z.enum(PLAYER_POSITIONS),
    fromRound: z.number(),
    toRound: z.number(),
    multiplier: z.number(),
  }),
]);

export const AiStrategyOutputSchema = z.object({
  name: z.string(),
  description: z.string(),
  weights: z.object({
    projection: z.number(),
    vor: z.number(),
    scarcity: z.number(),
    survival: z.number(),
    rosterNeed: z.number(),
    upside: z.number(),
  }),
  positionPriorities: z.object({
    QB: PrioritySchema,
    RB: PrioritySchema,
    WR: PrioritySchema,
    TE: PrioritySchema,
    K: PrioritySchema,
    DST: PrioritySchema,
  }),
  rules: z.array(AiRuleSchema),
  riskTolerance: z.enum(['conservative', 'balanced', 'aggressive']),
  playerNotes: z.array(
    z.object({
      name: z.string(),
      stance: z.enum(['target', 'avoid']),
      reason: z.string().nullable(),
    }),
  ),
  /** Draft slot the user mentioned (e.g. "I'm drafting 4th"), else null. */
  draftSlotMentioned: z.number().nullable(),
  /** Plain-language bullets of how the input was interpreted, shown to the user. */
  interpretationSummary: z.array(z.string()),
});
export type AiStrategyOutput = z.infer<typeof AiStrategyOutputSchema>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, lo: number, hi: number) => clamp(Math.round(x), lo, hi);

/** Sanitize model numbers into a valid DraftStrategy, then gate through the real schema. */
export function toDraftStrategy(out: AiStrategyOutput): DraftStrategy {
  const candidate: DraftStrategy = {
    id: `ai-${Date.now().toString(36)}`,
    name: out.name.slice(0, 60) || 'AI Strategy',
    description: out.description,
    weights: {
      projection: clamp(out.weights.projection, 0, 1),
      vor: clamp(out.weights.vor, 0, 1),
      scarcity: clamp(out.weights.scarcity, 0, 1),
      survival: clamp(out.weights.survival, 0, 1),
      rosterNeed: clamp(out.weights.rosterNeed, 0, 1),
      upside: clamp(out.weights.upside, 0, 1),
    },
    positionPriorities: out.positionPriorities,
    rules: out.rules.map((r) => {
      if (r.type === 'avoidPositionBefore') {
        return {
          type: 'avoidPositionBefore' as const,
          position: r.position,
          round: round(r.round, 1, 20),
          exceptionVorAdvantage:
            r.exceptionVorAdvantage === null ? undefined : clamp(r.exceptionVorAdvantage, 0, 200),
          penalty: clamp(r.penalty, 0, 1),
        };
      }
      if (r.type === 'limitPosition') {
        return { type: 'limitPosition' as const, position: r.position, max: round(r.max, 0, 12) };
      }
      return {
        type: 'boostPositionRounds' as const,
        position: r.position,
        fromRound: round(r.fromRound, 1, 20),
        toRound: round(Math.max(r.toRound, r.fromRound), 1, 20),
        multiplier: clamp(r.multiplier, 0.25, 2),
      };
    }),
    riskTolerance: out.riskTolerance,
    playerNotes: out.playerNotes.map((n) => ({
      name: n.name,
      stance: n.stance,
      reason: n.reason ?? undefined,
    })),
  };
  return DraftStrategySchema.parse(candidate);
}

/** One human-readable line per difference between two strategies. */
export function diffStrategies(before: DraftStrategy, after: DraftStrategy): string[] {
  const changes: string[] = [];
  const w = (k: keyof DraftStrategy['weights']) => {
    if (Math.abs(before.weights[k] - after.weights[k]) >= 0.005) {
      changes.push(`Weight ${k}: ${before.weights[k].toFixed(2)} -> ${after.weights[k].toFixed(2)}`);
    }
  };
  (['projection', 'vor', 'scarcity', 'survival', 'rosterNeed', 'upside'] as const).forEach(w);

  for (const pos of PLAYER_POSITIONS) {
    const a: PositionPriority = before.positionPriorities[pos] ?? 'normal';
    const b: PositionPriority = after.positionPriorities[pos] ?? 'normal';
    if (a !== b) changes.push(`${pos} priority: ${a} -> ${b}`);
  }

  if (before.riskTolerance !== after.riskTolerance) {
    changes.push(`Risk tolerance: ${before.riskTolerance} -> ${after.riskTolerance}`);
  }

  const ruleKey = (r: DraftStrategy['rules'][number]) => JSON.stringify(r);
  const beforeRules = new Set(before.rules.map(ruleKey));
  const afterRules = new Set(after.rules.map(ruleKey));
  const describeRule = (r: DraftStrategy['rules'][number]): string => {
    if (r.type === 'avoidPositionBefore') return `wait on ${r.position} until round ${r.round}`;
    if (r.type === 'limitPosition') return `cap ${r.position} at ${r.max}`;
    return `${r.multiplier > 1 ? 'boost' : 'dampen'} ${r.position} rounds ${r.fromRound}-${r.toRound}`;
  };
  for (const r of after.rules) {
    if (!beforeRules.has(ruleKey(r))) changes.push(`Added rule: ${describeRule(r)}`);
  }
  for (const r of before.rules) {
    if (!afterRules.has(ruleKey(r))) changes.push(`Removed rule: ${describeRule(r)}`);
  }

  const noteKey = (n: DraftStrategy['playerNotes'][number]) => `${n.stance}:${n.name.toLowerCase()}`;
  const beforeNotes = new Set(before.playerNotes.map(noteKey));
  const afterNotes = new Set(after.playerNotes.map(noteKey));
  for (const n of after.playerNotes) {
    if (!beforeNotes.has(noteKey(n))) changes.push(`Added ${n.stance}: ${n.name}`);
  }
  for (const n of before.playerNotes) {
    if (!afterNotes.has(noteKey(n))) changes.push(`Removed ${n.stance}: ${n.name}`);
  }

  return changes;
}
