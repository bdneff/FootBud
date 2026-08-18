import { useRef, useState } from 'react';
import { aggregateSource, ALL_SOURCES } from '../data/sources/aggregate';
import type { ProjectionSource } from '../data/sources/types';
import { parsePlayersCsv } from '../data/importCsv';
import { SAMPLE_SOURCE_NAME, samplePlayers } from '../data/sampleData';
import { useAppStore } from '../store';

const PICKER_SOURCES: ProjectionSource[] = [...ALL_SOURCES, aggregateSource];

export function PlayerDataSources() {
  const config = useAppStore((s) => s.config);
  const players = useAppStore((s) => s.players);
  const playerSourceName = useAppStore((s) => s.playerSourceName);
  const setPlayers = useAppStore((s) => s.setPlayers);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchFrom = async (source: ProjectionSource) => {
    if (busy) return;
    setBusy(source.id);
    setError(null);
    setWarnings([]);
    setCsvErrors([]);
    try {
      const result = await source.fetchPlayers(config.scoringFormat);
      setPlayers(result.players, result.sourceName);
      setWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onCsv = async (file: File) => {
    setError(null);
    setWarnings([]);
    const { players: parsed, errors } = parsePlayersCsv(await file.text());
    setCsvErrors(errors);
    if (parsed.length > 0) setPlayers(parsed, file.name);
    else if (errors.length > 0) setError('The CSV could not be imported. See the row errors below.');
  };

  return (
    <div className="data-sources">
      <p>
        Loaded: <strong>{playerSourceName}</strong> ({players.length} players)
      </p>
      <div className="button-row source-row">
        {PICKER_SOURCES.map((source) => (
          <button
            key={source.id}
            className="secondary"
            title={source.description}
            disabled={busy !== null}
            onClick={() => void fetchFrom(source)}
          >
            {busy === source.id ? `Loading ${source.label}...` : `Use ${source.label}`}
          </button>
        ))}
        <button className="secondary" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
          Upload your own CSV
        </button>
        <button
          className="secondary"
          disabled={busy !== null}
          onClick={() => {
            setPlayers(samplePlayers(), SAMPLE_SOURCE_NAME);
            setError(null);
            setWarnings([]);
            setCsvErrors([]);
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
            if (f) void onCsv(f);
            e.target.value = '';
          }}
        />
      </div>
      <p className="hint">
        Sources use your Scoring setting ({config.scoringFormat.replace('_', ' ')}) where they can.
        ESPN often blocks browser apps; if it fails, export a CSV from ESPN instead. Yahoo needs a
        sign-in server FootBud does not have yet. CSV columns: name, team, position,
        projected_points (or points/fpts), adp; optional adp_std_dev, tier, bye_week,
        injury_status.
      </p>
      {error && <p className="config-error">{error}</p>}
      {warnings.length > 0 && (
        <div className="import-errors">
          {warnings.map((warning, i) => (
            <div key={i}>{warning}</div>
          ))}
        </div>
      )}
      {csvErrors.length > 0 && (
        <div className="import-errors">
          <strong>{csvErrors.length} rows skipped:</strong>
          <ul>
            {csvErrors.slice(0, 5).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
            {csvErrors.length > 5 && <li>...and {csvErrors.length - 5} more</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
