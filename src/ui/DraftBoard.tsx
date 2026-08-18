import { rosterSize } from '../config/league';
import type { DraftState } from '../draft/state';
import { slotOnClock } from '../draft/order';

export function DraftBoard({ draft }: { draft: DraftState }) {
  const teams = draft.config.numberOfTeams;
  const rounds = rosterSize(draft.config.roster);
  const byOverall = new Map(draft.picks.map((p) => [p.overall, p]));
  const userSlot = draft.config.userDraftSlot;

  return (
    <div className="board-wrap">
      <table className="board">
        <thead>
          <tr>
            <th>Rd</th>
            {Array.from({ length: teams }, (_, i) => i + 1).map((slot) => (
              <th key={slot} className={slot === userSlot ? 'user-col' : ''}>
                {slot === userSlot ? `T${slot} (you)` : `T${slot}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rounds }, (_, r) => r + 1).map((round) => (
            <tr key={round}>
              <td className="round-cell">{round}</td>
              {Array.from({ length: teams }, (_, i) => i + 1).map((slot) => {
                // Which overall pick lands on this cell?
                const base = (round - 1) * teams;
                let overall = -1;
                for (let k = 1; k <= teams; k++) {
                  if (slotOnClock(base + k, teams, draft.config.draftType) === slot) {
                    overall = base + k;
                    break;
                  }
                }
                const pick = byOverall.get(overall);
                const player = pick ? draft.pool.get(pick.playerId) : undefined;
                const isCurrent = overall === draft.currentPick;
                return (
                  <td
                    key={slot}
                    className={[
                      player ? `cell pos-bg-${player.position}` : 'cell empty',
                      isCurrent ? 'current' : '',
                      slot === userSlot ? 'user-col' : '',
                    ].join(' ')}
                  >
                    {player ? (
                      <>
                        <span className="cell-pick">{overall}</span>
                        <span className="cell-name">{player.name}</span>
                      </>
                    ) : (
                      <span className="cell-pick">{overall}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
