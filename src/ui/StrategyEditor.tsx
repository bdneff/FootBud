import { useState } from 'react';
import { PLAYER_POSITIONS } from '../config/league';
import { useAppStore } from '../store';
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
          {activePresetId === 'custom' && <option value="custom">Custom (edited)</option>}
        </select>
      </label>
      <p className="hint">{strategy.description}</p>

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
          <p className="hint">
            Rules come from presets for now. A future AI strategy builder will translate plain
            language and uploaded documents into these structures.
          </p>
        </div>
      )}
    </div>
  );
}
