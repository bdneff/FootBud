import { useMemo, useState } from 'react';
import { PLAYER_POSITIONS, type Position } from '../config/league';
import type { Recommendation } from '../engine/recommend';
import { useAppStore } from '../store';

export function AvailablePlayers({ rec }: { rec: Recommendation | null }) {
  const draft = useAppStore((s) => s.draft);
  const makePick = useAppStore((s) => s.makePick);
  const liveSync = useAppStore((s) => s.liveSync);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<Position | 'ALL'>('ALL');
  const synced = liveSync !== null && liveSync.status !== 'complete';

  const scoreById = useMemo(() => {
    const m = new Map<string, number>();
    if (rec) for (const s of rec.scored) m.set(s.player.playerId, s.score);
    return m;
  }, [rec]);

  const rows = useMemo(() => {
    if (!draft) return [];
    const q = search.trim().toLowerCase();
    return draft.availablePlayers
      .filter((p) => posFilter === 'ALL' || p.position === posFilter)
      .filter((p) => q === '' || p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
      .slice(0, 120);
  }, [draft, search, posFilter]);

  if (!draft) return null;
  const onClockLabel =
    draft.slotOnClock === draft.config.userDraftSlot ? 'you' : `Team ${draft.slotOnClock}`;

  return (
    <>
      <div className="panel-title">Available players</div>
      <div className="filters">
        <input
          placeholder="Search name or team"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="pos-filters">
          {(['ALL', ...PLAYER_POSITIONS] as const).map((pos) => (
            <button
              key={pos}
              className={posFilter === pos ? 'chip active' : 'chip'}
              onClick={() => setPosFilter(pos as Position | 'ALL')}
            >
              {pos}
            </button>
          ))}
        </div>
      </div>
      {!draft.complete && (
        <p className="hint">
          {synced
            ? `Picks arrive automatically from ${liveSync!.sourceLabel}.`
            : `Click Draft to record the pick for ${onClockLabel}.`}
        </p>
      )}
      <div className="player-table-wrap">
        <table className="player-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Pos</th>
              <th className="num">ADP</th>
              <th className="num">Proj</th>
              <th className="num">Score</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const score = scoreById.get(p.playerId);
              return (
                <tr key={p.playerId}>
                  <td>
                    <span className="player-name">{p.name}</span>
                    <span className="player-team">{p.team}</span>
                    {p.injuryStatus && <span className="injury">{p.injuryStatus}</span>}
                  </td>
                  <td>
                    <span className={`pos-badge pos-${p.position}`}>{p.position}</span>
                  </td>
                  <td className="num">{p.adp.toFixed(1)}</td>
                  <td className="num">{p.projectedPoints.toFixed(0)}</td>
                  <td className="num">{score !== undefined ? score.toFixed(0) : '-'}</td>
                  <td>
                    <button
                      className="draft-btn"
                      disabled={draft.complete || synced}
                      onClick={() => makePick(p.playerId)}
                    >
                      Draft
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
