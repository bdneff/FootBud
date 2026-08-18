import { useState } from 'react';
import type { Position } from '../config/league';
import type { DraftState } from '../draft/state';

/**
 * Assign a team's drafted players to display slots: dedicated starters first,
 * then FLEX/SUPERFLEX, then bench, in draft order within each group.
 */
function slotAssignments(draft: DraftState, slot: number) {
  const roster = draft.rosters[slot - 1]!;
  const cfg = draft.config.roster;
  const groups: { label: string; player: string | null; position: Position | null }[] = [];
  const used = new Set<number>();

  const takeAt = (positions: Position[] | null): number | null => {
    for (let i = 0; i < roster.players.length; i++) {
      if (used.has(i)) continue;
      const p = roster.players[i]!;
      if (positions === null || positions.includes(p.position)) {
        used.add(i);
        return i;
      }
    }
    return null;
  };

  const addSlots = (label: string, count: number, positions: Position[] | null) => {
    for (let i = 0; i < count; i++) {
      const idx = takeAt(positions);
      const p = idx !== null ? roster.players[idx]! : null;
      groups.push({ label, player: p?.name ?? null, position: p?.position ?? null });
    }
  };

  addSlots('QB', cfg.QB, ['QB']);
  addSlots('RB', cfg.RB, ['RB']);
  addSlots('WR', cfg.WR, ['WR']);
  addSlots('TE', cfg.TE, ['TE']);
  addSlots('FLEX', cfg.FLEX, ['RB', 'WR', 'TE']);
  addSlots('SFLX', cfg.SUPERFLEX, ['QB', 'RB', 'WR', 'TE']);
  addSlots('K', cfg.K, ['K']);
  addSlots('DST', cfg.DST, ['DST']);
  addSlots('BN', cfg.BENCH, null);
  return groups;
}

export function RosterPanel({ draft }: { draft: DraftState }) {
  const userSlot = draft.config.userDraftSlot;
  const [viewSlot, setViewSlot] = useState(userSlot);
  const slots = slotAssignments(draft, viewSlot);

  return (
    <>
      <div className="panel-title">
        {viewSlot === userSlot ? 'My roster' : `Team ${viewSlot} roster`}
      </div>
      <select
        className="team-select"
        value={viewSlot}
        onChange={(e) => setViewSlot(Number(e.target.value))}
      >
        {draft.rosters.map((r) => (
          <option key={r.slot} value={r.slot}>
            {r.slot === userSlot ? `Team ${r.slot} (you)` : `Team ${r.slot}`}
          </option>
        ))}
      </select>
      <div className="roster-slots">
        {slots.map((s, i) => (
          <div key={i} className={s.player ? 'roster-slot filled' : 'roster-slot'}>
            <span className="slot-label">{s.label}</span>
            {s.player ? (
              <span className="slot-player">
                {s.position && <span className={`pos-dot pos-${s.position}`} />}
                {s.player}
              </span>
            ) : (
              <span className="slot-empty">empty</span>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
