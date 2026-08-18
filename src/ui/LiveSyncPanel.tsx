import { useState } from 'react';
import { sleeperDraftSource } from '../draft/sources/sleeper';
import type { ExternalDraftInfo } from '../draft/sources/types';
import { useAppStore } from '../store';

export function LiveSyncPanel() {
  const config = useAppStore((s) => s.config);
  const players = useAppStore((s) => s.players);
  const connectSleeperDraft = useAppStore((s) => s.connectSleeperDraft);
  const startEspnBridgeDraft = useAppStore((s) => s.startEspnBridgeDraft);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<ExternalDraftInfo[]>([]);
  const [slots, setSlots] = useState<Record<string, number>>({});
  const [showEspn, setShowEspn] = useState(false);

  const find = async () => {
    if (busy || input.trim() === '') return;
    setBusy(true);
    setError(null);
    setFound([]);
    try {
      const drafts = await sleeperDraftSource.findDrafts(input);
      setFound(drafts);
      const preset: Record<string, number> = {};
      for (const d of drafts) preset[d.draftId] = d.userSlot ?? config.userDraftSlot;
      setSlots(preset);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="live-sync">
      <p className="hint">
        Connect a real draft and picks flow in automatically while FootBud recommends. Load your
        projections first ({players.length} players loaded).
      </p>
      <div className="ai-chat-input">
        <input
          placeholder="Sleeper username, or a draft URL / id"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void find();
          }}
          disabled={busy}
        />
        <button className="secondary" onClick={() => void find()} disabled={busy || !input.trim()}>
          {busy ? 'Searching...' : 'Find Sleeper draft'}
        </button>
      </div>
      {found.length > 0 && (
        <ul className="sync-drafts">
          {found.map((d) => (
            <li key={d.draftId}>
              <div className="sync-draft-info">
                <strong>{d.name}</strong>
                <span className="muted">
                  {d.config.numberOfTeams} teams · {d.config.draftType} ·{' '}
                  {d.config.scoringFormat.replace('_', ' ')} · {d.status.replace('_', ' ')}
                </span>
              </div>
              <label className="sync-slot">
                Slot
                <select
                  value={slots[d.draftId] ?? 1}
                  onChange={(e) =>
                    setSlots((s) => ({ ...s, [d.draftId]: Number(e.target.value) }))
                  }
                >
                  {Array.from({ length: d.config.numberOfTeams }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                onClick={() => connectSleeperDraft(d, slots[d.draftId] ?? 1)}
              >
                Connect
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="config-error">{error}</p>}

      <button className="link" onClick={() => setShowEspn((v) => !v)}>
        {showEspn ? 'Hide ESPN setup' : 'Drafting on ESPN?'}
      </button>
      {showEspn && (
        <div className="espn-bridge-help">
          <p>
            ESPN has no public draft API, so FootBud uses a small companion browser extension that
            reads the draft room page you already have open and relays each pick here.
            Experimental: see <code>extension/README.md</code> in the FootBud repo to install it.
          </p>
          <ol>
            <li>Set up your league, roster, draft position, and projections above to match ESPN.</li>
            <li>Install the FootBud extension (chrome://extensions, developer mode, load unpacked).</li>
            <li>Open your ESPN draft room in another tab.</li>
            <li>Press the button below; picks appear as the extension reports them.</li>
          </ol>
          <button className="secondary" onClick={startEspnBridgeDraft}>
            Start ESPN-linked draft
          </button>
        </div>
      )}
    </div>
  );
}
