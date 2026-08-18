import { useMemo } from 'react';
import type { DraftState } from '../draft/state';
import { buildDecisionTree } from '../engine/decisionTree';
import type { Recommendation, ScoredPlayer } from '../engine/recommend';
import { useAppStore } from '../store';
import { DecisionTreeView } from './DecisionTreeView';
import { EngineDetails } from './EngineDetails';

function AltRow({ alt }: { alt: ScoredPlayer }) {
  const reason = alt.reasons[0] ?? 'Solid value at the position.';
  const wait = alt.cautions[0] ?? null;
  return (
    <div className="alt-row">
      <div className="alt-head">
        <span className={`pos-badge pos-${alt.player.position}`}>{alt.player.position}</span>
        <strong>{alt.player.name}</strong>
        <span className="alt-score">{alt.score.toFixed(0)}</span>
      </div>
      <div className="alt-detail">
        <span>VOR {alt.vorValue.toFixed(0)}</span>
        <span>{(alt.survivalToNextPick * 100).toFixed(0)}% survives</span>
        {alt.tier !== undefined && <span>Tier {alt.tier}</span>}
      </div>
      <div className="alt-reason">Draft: {reason}</div>
      {wait && <div className="alt-wait">Wait: {wait}</div>}
    </div>
  );
}

export function RecommendationPanel({
  rec,
  draft,
}: {
  rec: Recommendation | null;
  draft: DraftState;
}) {
  const makePick = useAppStore((s) => s.makePick);
  const liveSync = useAppStore((s) => s.liveSync);
  const synced = liveSync !== null && liveSync.status !== 'complete';
  const tree = useMemo(
    () => (rec && !draft.complete ? buildDecisionTree(draft, rec) : null),
    [draft, rec],
  );

  if (draft.complete || !rec || !rec.best) {
    return (
      <>
        <div className="panel-title">Recommendation</div>
        <p className="hint">Draft complete. Review the board below.</p>
      </>
    );
  }

  const best = rec.best;
  const userIsOnClock = draft.slotOnClock === draft.config.userDraftSlot;

  return (
    <>
      <div className="panel-title">
        {userIsOnClock ? 'Best pick now' : `Planning your pick ${rec.nextUserPick ?? ''}`}
      </div>

      <div className="best-pick">
        <div className="best-head">
          <span className={`pos-badge pos-${best.player.position}`}>{best.player.position}</span>
          <div>
            <div className="best-name">{best.player.name}</div>
            <div className="best-meta">
              {best.player.team} · VOR {best.vorValue.toFixed(0)}
              {best.tier !== undefined ? ` · Tier ${best.tier}` : ''}
            </div>
          </div>
          <div className="best-score">
            <div className="best-score-num">{best.score.toFixed(0)}</div>
            <div className="best-score-label">score</div>
          </div>
        </div>
        <ul className="reasons">
          {best.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
          {best.reasons.length === 0 && <li>Best combination of value and timing available.</li>}
        </ul>
        {best.cautions.length > 0 && (
          <ul className="cautions">
            {best.cautions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
        {userIsOnClock && !synced && (
          <button className="primary" onClick={() => makePick(best.player.playerId)}>
            Draft {best.player.name}
          </button>
        )}
        {userIsOnClock && synced && (
          <p className="hint">Make this pick in your {liveSync!.sourceLabel} draft room.</p>
        )}
      </div>

      <div className="section-title">Alternatives</div>
      <div className="alternatives">
        {rec.alternatives.map((alt) => (
          <AltRow key={alt.player.playerId} alt={alt} />
        ))}
      </div>

      <div className="section-title">
        Will he make it back{rec.userPickAfterNext || rec.nextUserPick ? '?' : ''}
        {(() => {
          const horizon = userIsOnClock ? rec.userPickAfterNext : rec.nextUserPick;
          return horizon ? ` (to pick ${horizon})` : '';
        })()}
      </div>
      <div className="survival-board">
        {rec.survivalBoard.slice(0, 8).map(({ player, probability }) => (
          <div key={player.playerId} className="survival-row">
            <span className="survival-name">
              <span className={`pos-dot pos-${player.position}`} />
              {player.name}
            </span>
            <div className="survival-bar-track">
              <div
                className={`survival-bar ${probability < 0.35 ? 'danger' : probability < 0.65 ? 'warn' : ''}`}
                style={{ width: `${Math.max(3, probability * 100)}%` }}
              />
            </div>
            <span className="survival-pct">{(probability * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>

      {rec.pairOptions.length > 0 && (
        <>
          <div className="section-title">Two-pick plan</div>
          <ol className="pair-options">
            {rec.pairOptions.slice(0, 3).map((opt, i) => (
              <li key={i}>
                <strong>{opt.now.player.name}</strong> now, then {opt.thenPosition}
                {opt.thenLikelyPlayer ? ` (likely ${opt.thenLikelyPlayer.name})` : ''} · combined
                value {opt.combinedValue.toFixed(0)}
              </li>
            ))}
          </ol>
        </>
      )}

      <DecisionTreeView tree={tree} />
      <EngineDetails rec={rec} />
    </>
  );
}
