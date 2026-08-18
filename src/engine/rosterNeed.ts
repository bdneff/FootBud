import {
  FLEX_ELIGIBLE,
  SUPERFLEX_ELIGIBLE,
  type Position,
  type RosterConfig,
} from '../config/league';
import { clamp } from './math';

/**
 * How much a team currently needs a position, 0..1.
 *
 * Dedicated starter slots dominate; open FLEX/SUPERFLEX slots give partial
 * need to eligible positions; after starters are covered, need decays with
 * each additional bench body at the position.
 */
export function rosterNeed(
  position: Position,
  counts: Record<Position, number>,
  roster: RosterConfig,
): number {
  const have = counts[position];
  const dedicated = roster[position];

  if (have < dedicated) return 1;

  // Starters filled. Does an open flex-type slot still want this position?
  const flexUsed = flexConsumed(counts, roster);
  const surplus = have - dedicated;

  let need = 0;
  if (FLEX_ELIGIBLE.includes(position) && flexUsed.flexOpen > 0) {
    need = Math.max(need, 0.55);
  }
  if (SUPERFLEX_ELIGIBLE.includes(position) && flexUsed.superflexOpen > 0) {
    need = Math.max(need, position === 'QB' ? 0.8 : 0.4);
  }

  // Bench depth: RB/WR benefit from depth, QB/TE/K/DST barely do.
  const depthAppetite: Record<Position, number> = { QB: 1, RB: 4, WR: 4, TE: 1, K: 0, DST: 0 };
  const flexSurplusUsed = Math.min(surplus, flexUsed.surplusAbsorbedByFlex.get(position) ?? 0);
  const benchBodies = surplus - flexSurplusUsed;
  const appetite = depthAppetite[position];
  if (appetite > 0 && benchBodies < appetite) {
    need = Math.max(need, 0.35 * (1 - benchBodies / appetite));
  }
  return clamp(need, 0, 1);
}

interface FlexUsage {
  flexOpen: number;
  superflexOpen: number;
  /** How many surplus players per position were absorbed into flex slots. */
  surplusAbsorbedByFlex: Map<Position, number>;
}

/** Greedy fill: dedicated slots first, then surplus players occupy FLEX/SUPERFLEX. */
function flexConsumed(counts: Record<Position, number>, roster: RosterConfig): FlexUsage {
  let flexOpen = roster.FLEX;
  let superflexOpen = roster.SUPERFLEX;
  const absorbed = new Map<Position, number>();

  for (const pos of FLEX_ELIGIBLE) {
    let surplus = Math.max(0, counts[pos] - roster[pos]);
    const used = Math.min(surplus, flexOpen);
    flexOpen -= used;
    surplus -= used;
    absorbed.set(pos, used);
  }
  for (const pos of SUPERFLEX_ELIGIBLE) {
    const alreadyAbsorbed = absorbed.get(pos) ?? 0;
    const surplus = Math.max(0, counts[pos] - roster[pos] - alreadyAbsorbed);
    const used = Math.min(surplus, superflexOpen);
    superflexOpen -= used;
    absorbed.set(pos, alreadyAbsorbed + used);
  }
  return { flexOpen, superflexOpen, surplusAbsorbedByFlex: absorbed };
}
