import { useState } from 'react';
import {
  DEFAULT_LEAGUE,
  LeagueConfigSchema,
  rosterSize,
  totalPicks,
  type LeagueConfig,
  type RosterConfig,
} from '../config/league';
import { hasSavedDraft, useAppStore } from '../store';
import { AiKeySettings, AiStrategyBuilder } from './AiStrategyBuilder';
import { LiveSyncPanel } from './LiveSyncPanel';
import { Logo } from './Logo';
import { PlayerDataSources } from './PlayerDataSources';
import { StrategyEditor } from './StrategyEditor';

const TEAM_COUNTS = [8, 10, 12, 14, 16];

export function SetupScreen() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const players = useAppStore((s) => s.players);
  const startDraft = useAppStore((s) => s.startDraft);
  const loadSavedDraft = useAppStore((s) => s.loadSavedDraft);

  const [configError, setConfigError] = useState<string | null>(null);

  const update = (patch: Partial<LeagueConfig>) => {
    const next = { ...config, ...patch };
    // Keep the slot in range when the team count shrinks.
    if (next.userDraftSlot > next.numberOfTeams) next.userDraftSlot = next.numberOfTeams;
    setConfig(next);
  };
  const updateRoster = (patch: Partial<RosterConfig>) =>
    update({ roster: { ...config.roster, ...patch } });

  const onStart = () => {
    const check = LeagueConfigSchema.safeParse(config);
    if (!check.success) {
      setConfigError(check.error.issues[0]?.message ?? 'Invalid league configuration');
      return;
    }
    const picksNeeded = totalPicks(config);
    if (players.length < picksNeeded) {
      setConfigError(
        `Not enough players: this league drafts ${picksNeeded} players but only ${players.length} are loaded.`,
      );
      return;
    }
    setConfigError(null);
    startDraft();
  };

  return (
    <div className="setup">
      <header className="setup-header">
        <h1 className="visually-hidden">FootBud</h1>
        <Logo height={44} />
        <p className="tagline">
          Given the current draft state, who should you take now, and what are you risking by
          waiting?
        </p>
        {hasSavedDraft() && (
          <button className="secondary" onClick={loadSavedDraft}>
            Resume saved draft
          </button>
        )}
      </header>

      <div className="setup-grid">
        <section className="setup-card">
          <h2>League</h2>
          <label>
            League name
            <input
              value={config.leagueName}
              onChange={(e) => update({ leagueName: e.target.value })}
            />
          </label>
          <div className="field-row">
            <label>
              Teams
              <select
                value={config.numberOfTeams}
                onChange={(e) => update({ numberOfTeams: Number(e.target.value) })}
              >
                {TEAM_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Your draft position
              <select
                value={config.userDraftSlot}
                onChange={(e) => update({ userDraftSlot: Number(e.target.value) })}
              >
                {Array.from({ length: config.numberOfTeams }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Draft type
              <select
                value={config.draftType}
                onChange={(e) => update({ draftType: e.target.value as LeagueConfig['draftType'] })}
              >
                <option value="snake">Snake</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <label>
              Scoring
              <select
                value={config.scoringFormat}
                onChange={(e) =>
                  update({ scoringFormat: e.target.value as LeagueConfig['scoringFormat'] })
                }
              >
                <option value="standard">Standard</option>
                <option value="half_ppr">Half PPR</option>
                <option value="ppr">Full PPR</option>
              </select>
            </label>
          </div>
          <p className="hint">
            Scoring is a label for now: projections should already be in your league's format.
          </p>

          <h2>Roster</h2>
          <div className="roster-grid">
            {(
              [
                ['QB', 'QB'],
                ['RB', 'RB'],
                ['WR', 'WR'],
                ['TE', 'TE'],
                ['FLEX', 'Flex'],
                ['SUPERFLEX', 'Superflex'],
                ['K', 'K'],
                ['DST', 'DST'],
                ['BENCH', 'Bench'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={0}
                  max={key === 'BENCH' ? 12 : 8}
                  value={config.roster[key]}
                  onChange={(e) => updateRoster({ [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <p className="hint">
            {rosterSize(config.roster)} roster spots per team, {totalPicks(config)} total picks.
          </p>

          <h2>Live draft sync</h2>
          <LiveSyncPanel />
        </section>

        <section className="setup-card">
          <h2>Player data</h2>
          <PlayerDataSources />

          <h2>Strategy</h2>
          <AiStrategyBuilder />
          <StrategyEditor />

          <h2>AI</h2>
          <AiKeySettings />
        </section>
      </div>

      <footer className="setup-footer">
        {configError && <span className="config-error">{configError}</span>}
        <button className="primary" onClick={onStart}>
          Start draft
        </button>
        <button
          className="secondary"
          onClick={() => {
            useAppStore.getState().setConfig(DEFAULT_LEAGUE);
          }}
        >
          Reset league to 12-team 1.01 default
        </button>
      </footer>
    </div>
  );
}
