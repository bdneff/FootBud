import { useMemo, useState } from 'react';
import { recommend } from '../engine/recommend';
import { useAppStore } from '../store';
import { AskAi } from './AskAi';
import { AvailablePlayers } from './AvailablePlayers';
import { DraftBoard } from './DraftBoard';
import { EspnCountdown } from './EspnClock';
import { Logo } from './Logo';
import { RecommendationPanel } from './RecommendationPanel';
import { RosterPanel } from './RosterPanel';
import { StrategyEditor } from './StrategyEditor';

export function DraftScreen() {
  const draft = useAppStore((s) => s.draft);
  const strategy = useAppStore((s) => s.strategy);
  const undo = useAppStore((s) => s.undo);
  const exitToSetup = useAppStore((s) => s.exitToSetup);
  const liveSync = useAppStore((s) => s.liveSync);
  const pauseLiveSync = useAppStore((s) => s.pauseLiveSync);
  const resumeLiveSync = useAppStore((s) => s.resumeLiveSync);
  const disconnectLiveSync = useAppStore((s) => s.disconnectLiveSync);
  const [showBoard, setShowBoard] = useState(true);
  const [showStrategy, setShowStrategy] = useState(false);

  const rec = useMemo(
    () => (draft && !draft.complete ? recommend(draft, strategy) : null),
    [draft, strategy],
  );

  if (!draft) return null;

  const userIsOnClock = draft.slotOnClock === draft.config.userDraftSlot;

  return (
    <div className="draft-screen">
      <header className="draft-header">
        <div className="draft-status">
          <Logo height={30} />
          <strong>{draft.config.leagueName}</strong>
          {draft.complete ? (
            <span className="on-clock">Draft complete</span>
          ) : (
            <>
              <span>
                Round {draft.currentRound}, pick {draft.currentPick}
              </span>
              <span className={userIsOnClock ? 'on-clock user' : 'on-clock'}>
                {userIsOnClock ? 'YOU are on the clock' : `Team ${draft.slotOnClock} on the clock`}
              </span>
              {draft.nextUserPick !== null && !userIsOnClock && (
                <span className="muted">
                  Your next pick: {draft.nextUserPick} ({draft.picksUntilUserPick} away)
                </span>
              )}
            </>
          )}
        </div>
        <div className="draft-actions">
          {liveSync && (
            <span className={`sync-badge ${liveSync.status}`}>
              <span className="sync-dot" />
              {liveSync.sourceLabel}:{' '}
              {liveSync.status === 'polling'
                ? `live (${liveSync.pickCount} picks)`
                : liveSync.status === 'paused'
                  ? 'paused'
                  : 'complete'}
              {liveSync.error ? ' · retrying' : ''}
            </span>
          )}
          {liveSync?.sourceId === 'espn-bridge' && liveSync.espnClock && (
            <EspnCountdown clock={liveSync.espnClock} />
          )}
          {liveSync && liveSync.status !== 'complete' && (
            <button
              className="secondary"
              onClick={liveSync.status === 'paused' ? resumeLiveSync : pauseLiveSync}
            >
              {liveSync.status === 'paused' ? 'Resume sync' : 'Pause sync'}
            </button>
          )}
          {liveSync && (
            <button
              className="secondary"
              onClick={() => {
                if (window.confirm('Disconnect the live sync? You can then enter picks manually.')) {
                  disconnectLiveSync();
                }
              }}
            >
              Disconnect
            </button>
          )}
          <button
            className="secondary"
            onClick={undo}
            disabled={draft.picks.length === 0 || (liveSync !== null && liveSync.status !== 'complete')}
          >
            Undo pick
          </button>
          <button className="secondary" onClick={() => setShowStrategy((v) => !v)}>
            Strategy
          </button>
          <button
            className="secondary"
            onClick={() => {
              if (window.confirm('Leave this draft? It stays saved and can be resumed.')) {
                exitToSetup();
              }
            }}
          >
            Exit
          </button>
        </div>
      </header>

      {showStrategy && (
        <div className="strategy-drawer">
          <StrategyEditor />
        </div>
      )}

      <div className="draft-main">
        <section className="panel available-panel">
          <AvailablePlayers rec={rec} />
        </section>
        <section className="panel recommendation-panel">
          <RecommendationPanel rec={rec} draft={draft} />
        </section>
        <section className="panel roster-panel">
          <RosterPanel draft={draft} />
          <AskAi draft={draft} rec={rec} />
        </section>
      </div>

      <section className="board-section">
        <button className="link" onClick={() => setShowBoard((v) => !v)}>
          {showBoard ? 'Hide draft board' : 'Show draft board'}
        </button>
        {showBoard && <DraftBoard draft={draft} />}
      </section>
    </div>
  );
}
