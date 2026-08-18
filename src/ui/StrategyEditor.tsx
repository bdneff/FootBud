import { useState } from 'react';
import { diffStrategies, toDraftStrategy } from '../ai/schemas';
import { PLAYER_POSITIONS } from '../config/league';
import { getAiProvider, useAppStore } from '../store';
import { STRATEGY_PRESETS } from '../strategy/presets';
import type { PositionPriority, StrategyWeights } from '../strategy/types';

const WEIGHT_LABELS: Record<keyof StrategyWeights, string> = {
  projection: 'Projected production',
  vor: 'Value over replacement',
  scarcity: 'Positional scarcity',
  survival: 'Will he make it back',
  rosterNeed: 'Roster need',
  upside: 'Value vs ADP',
};

const PRIORITY_OPTIONS: PositionPriority[] = ['high', 'normal', 'patient', 'avoid'];

export function StrategyEditor() {
  const strategy = useAppStore((s) => s.strategy);
  const setStrategy = useAppStore((s) => s.setStrategy);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const activePresetId = STRATEGY_PRESETS.some((p) => p.id === strategy.id) ? strategy.id : 'custom';

  return (
    <div className="strategy-editor">
      <label>
        Preset
        <select
          value={activePresetId}
          onChange={(e) => {
            const preset = STRATEGY_PRESETS.find((p) => p.id === e.target.value);
            if (preset) setStrategy(preset);
          }}
        >
          {STRATEGY_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {activePresetId === 'custom' && <option value="custom">{strategy.name}</option>}
        </select>
      </label>
      <p className="hint">{strategy.description}</p>

      <AiAdjust />

      <button className="link" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
      </button>

      {showAdvanced && (
        <div className="strategy-advanced">
          <h3>Weights</h3>
          {(Object.keys(WEIGHT_LABELS) as (keyof StrategyWeights)[]).map((key) => (
            <label key={key} className="weight-row">
              <span>{WEIGHT_LABELS[key]}</span>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={strategy.weights[key]}
                onChange={(e) =>
                  setStrategy({
                    ...strategy,
                    id: 'custom',
                    name: 'Custom',
                    weights: { ...strategy.weights, [key]: Number(e.target.value) },
                  })
                }
              />
              <span className="weight-value">{strategy.weights[key].toFixed(2)}</span>
            </label>
          ))}

          <h3>Position priorities</h3>
          <div className="priority-grid">
            {PLAYER_POSITIONS.map((pos) => (
              <label key={pos}>
                {pos}
                <select
                  value={strategy.positionPriorities[pos] ?? 'normal'}
                  onChange={(e) =>
                    setStrategy({
                      ...strategy,
                      id: 'custom',
                      name: 'Custom',
                      positionPriorities: {
                        ...strategy.positionPriorities,
                        [pos]: e.target.value as PositionPriority,
                      },
                    })
                  }
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h3>Rules</h3>
          <ul className="rules-list">
            {strategy.rules.map((rule, i) => (
              <li key={i}>
                {rule.type === 'avoidPositionBefore' &&
                  `Wait on ${rule.position} until round ${rule.round}` +
                    (rule.exceptionVorAdvantage !== undefined
                      ? ` unless value beats everything else by ${rule.exceptionVorAdvantage}+ points`
                      : '')}
                {rule.type === 'limitPosition' && `Roster at most ${rule.max} ${rule.position}`}
                {rule.type === 'boostPositionRounds' &&
                  `${rule.multiplier > 1 ? 'Boost' : 'Dampen'} ${rule.position} in rounds ${rule.fromRound}-${rule.toRound} (x${rule.multiplier})`}
                <button
                  className="link"
                  onClick={() =>
                    setStrategy({
                      ...strategy,
                      id: 'custom',
                      name: 'Custom',
                      rules: strategy.rules.filter((_, j) => j !== i),
                    })
                  }
                >
                  remove
                </button>
              </li>
            ))}
            {strategy.rules.length === 0 && <li className="hint">No rules.</li>}
          </ul>

          <h3>Player reads</h3>
          <ul className="rules-list">
            {strategy.playerNotes.map((note, i) => (
              <li key={i}>
                {note.stance === 'target' ? 'Target' : 'Avoid'}: {note.name}
                {note.reason ? ` (${note.reason})` : ''}
                <button
                  className="link"
                  onClick={() =>
                    setStrategy({
                      ...strategy,
                      playerNotes: strategy.playerNotes.filter((_, j) => j !== i),
                    })
                  }
                >
                  remove
                </button>
              </li>
            ))}
            {strategy.playerNotes.length === 0 && (
              <li className="hint">No player reads. Add them via the AI builder or Adjust with AI.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Plain-language strategy edits: "don't draft a QB before round 6". */
function AiAdjust() {
  const strategy = useAppStore((s) => s.strategy);
  const setStrategy = useAppStore((s) => s.setStrategy);
  const config = useAppStore((s) => s.config);
  const players = useAppStore((s) => s.players);
  const aiApiKey = useAppStore((s) => s.aiApiKey);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!aiApiKey.trim()) return null;

  const apply = async () => {
    const provider = getAiProvider();
    if (!provider || busy || instruction.trim() === '') return;
    setBusy(true);
    setError(null);
    setChanges(null);
    try {
      const output = await provider.modifyStrategy(config, players, strategy, instruction.trim());
      const revised = toDraftStrategy(output);
      // Keep the existing identity unless the AI meaningfully renamed it.
      const next = { ...revised, id: 'custom', name: strategy.name === revised.name ? strategy.name : revised.name };
      setChanges(diffStrategies(strategy, next));
      setStrategy(next);
      setInstruction('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-adjust">
      <div className="ai-chat-input">
        <textarea
          rows={2}
          placeholder='Adjust with AI: "be more aggressive on WR in rounds 2-4", "no QB before round 6"...'
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void apply();
            }
          }}
          disabled={busy}
        />
        <button className="secondary" onClick={() => void apply()} disabled={busy || !instruction.trim()}>
          {busy ? 'Adjusting...' : 'Apply'}
        </button>
      </div>
      {changes !== null && (
        <div className="ai-changes">
          <strong>Changed:</strong>
          {changes.length === 0 ? (
            <p className="hint">No effective change. Try being more specific.</p>
          ) : (
            <ul>
              {changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="config-error">{error}</p>}
    </div>
  );
}
