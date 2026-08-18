import { useState } from 'react';
import type { Recommendation } from '../engine/recommend';

/**
 * The debugging/analysis view the build plan asks for: replacement
 * baselines and the cost of waiting at each position, so the engine's
 * assumptions can be sanity checked mid-draft.
 */
export function EngineDetails({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="engine-details">
      <button className="link" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide engine details' : 'Engine details'}
      </button>
      {open && (
        <div className="engine-tables">
          <div className="section-title">Replacement baselines</div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Replacement player</th>
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {[...rec.baselines.values()].map((b) => (
                <tr key={b.position}>
                  <td>{b.position}</td>
                  <td>{b.replacementPlayerName ?? '-'}</td>
                  <td className="num">{b.replacementPoints.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="section-title">Cost of waiting one turn</div>
          <table className="mini-table">
            <thead>
              <tr>
                <th>Pos</th>
                <th>Best now</th>
                <th className="num">VOR now</th>
                <th className="num">Expected next</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rec.waitByPosition
                .filter((w) => w.bestNow)
                .map((w) => (
                  <tr key={w.position}>
                    <td>{w.position}</td>
                    <td>{w.bestNow!.name}</td>
                    <td className="num">{w.bestNowVor.toFixed(0)}</td>
                    <td className="num">{w.expectedBestVorAtNextPick.toFixed(0)}</td>
                    <td className="num">{w.costOfWaiting.toFixed(0)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
