import { useRef, useState } from 'react';
import {
  DEFAULT_LEAGUE,
  LeagueConfigSchema,
  rosterSize,
  totalPicks,
  type LeagueConfig,
  type RosterConfig,
} from '../config/league';
import { parsePlayersCsv } from '../data/importCsv';
import { SAMPLE_SOURCE_NAME, samplePlayers } from '../data/sampleData';
import { hasSavedDraft, useAppStore } from '../store';
import { StrategyEditor } from './StrategyEditor';

const TEAM_COUNTS = [8, 10, 12, 14, 16];

export function SetupScreen() {
  const config = useAppStore((s) => s.config);
  const setConfig = useAppStore((s) => s.setConfig);
  const players = useAppStore((s) => s.players);
  const playerSourceName = useAppStore((s) => s.playerSourceName);
  const setPlayers = useAppStore((s) => s.setPlayers);
  const startDraft = useAppStore((s) => s.startDraft);
  const loadSavedDraft = useAppStore((s) => s.loadSavedDraft);

  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<LeagueConfig>) => {
    const next = { ...config, ...patch };
    // Keep the slot in range when the team count shrinks.
    if (next.userDraftSlot > next.numberOfTeams) next.userDraftSlot = next.numberOfTeams;
    setConfig(next);
  };
  const updateRoster = (patch: Partial<RosterConfig>) =>
    update({ roster: { ...config.roster, ...patch } });

  const onFile = async (file: File) => {
    const text = await file.text();
    const { players: parsed, errors } = parsePlayersCsv(text);
    setImportErrors(errors);
    if (parsed.length > 0) setPlayers(parsed, file.name);
  };

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
        <h1>FootBud</h1>
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
              Your slot
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
        </section>

        <section className="setup-card">
          <h2>Player data</h2>
          <p>
            Loaded: <strong>{playerSourceName}</strong> ({players.length} players)
          </p>
          <div className="button-row">
            <button className="secondary" onClick={() => fileRef.current?.click()}>
              Import CSV
            </button>
            <button
              className="secondary"
              onClick={() => {
                setPlayers(samplePlayers(), SAMPLE_SOURCE_NAME);
                setImportErrors([]);
              }}
            >
              Use sample data
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
                e.target.value = '';
              }}
            />
          </div>
          <p className="hint">
            CSV needs columns: name, team, position, projected_points (or points/fpts), adp.
            Optional: adp_std_dev, tier, bye_week, injury_status.
          </p>
          {importErrors.length > 0 && (
            <div className="import-errors">
              <strong>{importErrors.length} rows skipped:</strong>
              <ul>
                {importErrors.slice(0, 5).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {importErrors.length > 5 && <li>...and {importErrors.length - 5} more</li>}
              </ul>
            </div>
          )}

          <h2>Strategy</h2>
          <StrategyEditor />
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
