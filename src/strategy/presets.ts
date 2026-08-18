import type { DraftStrategy, StrategyRule } from './types';

/**
 * Shipped presets, all editable. The default is the 12-team / 1.01
 * quantitative strategy from the build plan: value and opportunity cost
 * driven, patient at QB, K and DST in the final rounds only.
 */

const LATE_KICKER_DST: StrategyRule[] = [
  { type: 'avoidPositionBefore', position: 'K', round: 14, penalty: 0.15 },
  { type: 'avoidPositionBefore', position: 'DST', round: 13, penalty: 0.2 },
  { type: 'limitPosition', position: 'K', max: 1 },
  { type: 'limitPosition', position: 'DST', max: 1 },
];

export const QUANT_1_01: DraftStrategy = {
  id: 'quant-12-team-1-01',
  name: 'Quantitative 12-team 1.01',
  description:
    'The default strategy from the quantitative build plan for a 12-team snake draft from the first pick. Maximizes expected value across paired turn picks, leans on elite RB/WR early, waits on QB unless exceptional value falls, and weighs whether players will survive the long wheel back to your next pick.',
  weights: {
    projection: 0.2,
    vor: 0.27,
    scarcity: 0.18,
    survival: 0.2,
    rosterNeed: 0.1,
    upside: 0.05,
  },
  positionPriorities: { RB: 'high', WR: 'high', TE: 'normal', QB: 'patient', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'avoidPositionBefore', position: 'QB', round: 5, exceptionVorAdvantage: 25, penalty: 0.6 },
    { type: 'limitPosition', position: 'QB', max: 2 },
    { type: 'limitPosition', position: 'TE', max: 2 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'balanced',
};

export const BALANCED_VALUE: DraftStrategy = {
  id: 'balanced-value',
  name: 'Balanced Value',
  description:
    'Emphasizes expected value and positional opportunity cost with no strong positional lean. Good default for unfamiliar leagues.',
  weights: {
    projection: 0.25,
    vor: 0.25,
    scarcity: 0.15,
    survival: 0.2,
    rosterNeed: 0.1,
    upside: 0.05,
  },
  positionPriorities: { RB: 'normal', WR: 'normal', TE: 'normal', QB: 'patient', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'avoidPositionBefore', position: 'QB', round: 4, exceptionVorAdvantage: 30, penalty: 0.7 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'balanced',
};

export const HERO_RB: DraftStrategy = {
  id: 'hero-rb',
  name: 'Hero RB',
  description:
    'Take one elite RB early, then hammer WR and value. RB priority drops sharply after the first RB is rostered (the boost window covers only the opening rounds).',
  weights: {
    projection: 0.22,
    vor: 0.24,
    scarcity: 0.16,
    survival: 0.2,
    rosterNeed: 0.13,
    upside: 0.05,
  },
  positionPriorities: { RB: 'normal', WR: 'high', TE: 'normal', QB: 'patient', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'boostPositionRounds', position: 'RB', fromRound: 1, toRound: 2, multiplier: 1.15 },
    { type: 'boostPositionRounds', position: 'RB', fromRound: 3, toRound: 7, multiplier: 0.85 },
    { type: 'avoidPositionBefore', position: 'QB', round: 5, exceptionVorAdvantage: 30, penalty: 0.6 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'aggressive',
};

export const ZERO_RB: DraftStrategy = {
  id: 'zero-rb',
  name: 'Zero RB',
  description:
    'De-emphasize RB in the early rounds unless exceptional value falls; load up on WR and elite TE, then attack RB volume in the middle rounds.',
  weights: {
    projection: 0.22,
    vor: 0.24,
    scarcity: 0.14,
    survival: 0.2,
    rosterNeed: 0.12,
    upside: 0.08,
  },
  positionPriorities: { RB: 'patient', WR: 'high', TE: 'high', QB: 'patient', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'avoidPositionBefore', position: 'RB', round: 4, exceptionVorAdvantage: 35, penalty: 0.7 },
    { type: 'boostPositionRounds', position: 'RB', fromRound: 5, toRound: 10, multiplier: 1.12 },
    { type: 'avoidPositionBefore', position: 'QB', round: 5, exceptionVorAdvantage: 30, penalty: 0.6 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'aggressive',
};

export const ROBUST_RB: DraftStrategy = {
  id: 'robust-rb',
  name: 'Robust RB',
  description:
    'Prioritize RB depth early: bank the scarcest position while it lasts and fill WR from the mid-round surplus.',
  weights: {
    projection: 0.22,
    vor: 0.26,
    scarcity: 0.2,
    survival: 0.17,
    rosterNeed: 0.1,
    upside: 0.05,
  },
  positionPriorities: { RB: 'high', WR: 'normal', TE: 'patient', QB: 'patient', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'boostPositionRounds', position: 'RB', fromRound: 1, toRound: 5, multiplier: 1.12 },
    { type: 'avoidPositionBefore', position: 'QB', round: 6, exceptionVorAdvantage: 35, penalty: 0.55 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'conservative',
};

export const LATE_ROUND_QB: DraftStrategy = {
  id: 'late-round-qb',
  name: 'Late-Round QB',
  description:
    'Strongly penalize QB opportunity cost early. QBs are deep; spend premium picks on positions where the replacement level falls off a cliff.',
  weights: {
    projection: 0.22,
    vor: 0.27,
    scarcity: 0.18,
    survival: 0.18,
    rosterNeed: 0.1,
    upside: 0.05,
  },
  positionPriorities: { RB: 'high', WR: 'high', TE: 'normal', QB: 'avoid', K: 'avoid', DST: 'avoid' },
  rules: [
    { type: 'avoidPositionBefore', position: 'QB', round: 8, exceptionVorAdvantage: 45, penalty: 0.45 },
    { type: 'limitPosition', position: 'QB', max: 2 },
    ...LATE_KICKER_DST,
  ],
  riskTolerance: 'balanced',
};

export const STRATEGY_PRESETS: DraftStrategy[] = [
  QUANT_1_01,
  BALANCED_VALUE,
  HERO_RB,
  ZERO_RB,
  ROBUST_RB,
  LATE_ROUND_QB,
];

export const DEFAULT_STRATEGY = QUANT_1_01;
