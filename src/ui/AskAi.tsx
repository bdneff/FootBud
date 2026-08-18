import { useEffect, useRef, useState } from 'react';
import { buildDraftSnapshot } from '../ai/context';
import type { ChatTurn } from '../ai/provider';
import type { DraftState } from '../draft/state';
import type { Recommendation } from '../engine/recommend';
import { getAiProvider, useAppStore } from '../store';

const SUGGESTED = [
  'Why this pick over the highest-ranked player?',
  'What happens if I wait on this position?',
  'What are my biggest risks right now?',
];

export function AskAi({ draft, rec }: { draft: DraftState; rec: Recommendation | null }) {
  const strategy = useAppStore((s) => s.strategy);
  const aiApiKey = useAppStore((s) => s.aiApiKey);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [history, streamText]);

  const provider = getAiProvider();

  const ask = async (question: string) => {
    if (!provider || busy || question.trim() === '') return;
    const q = question.trim();
    setInput('');
    setBusy(true);
    setError(null);
    setHistory((h) => [...h, { role: 'user', content: q }]);
    setStreamText('');
    try {
      // Snapshot is rebuilt per question so answers always match the board.
      const snapshot = buildDraftSnapshot(draft, rec, strategy);
      const text = await provider.askDraftQuestion(snapshot, history, q, (t) =>
        setStreamText((s) => (s ?? '') + t),
      );
      setHistory((h) => [...h, { role: 'assistant', content: text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHistory((h) => h.slice(0, -1));
      setInput(q);
    } finally {
      setStreamText(null);
      setBusy(false);
    }
  };

  if (!aiApiKey.trim()) {
    return (
      <div className="ask-ai">
        <div className="section-title">Ask AI</div>
        <p className="hint">
          Add your Anthropic API key on the setup screen to ask questions about the draft.
        </p>
      </div>
    );
  }

  return (
    <div className="ask-ai">
      <div className="section-title">Ask AI</div>
      {history.length === 0 && streamText === null && (
        <div className="ask-suggestions">
          {SUGGESTED.map((q) => (
            <button key={q} className="chip" onClick={() => void ask(q)} disabled={busy}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="ai-chat-log ask-log">
        {history.map((t, i) => (
          <div key={i} className={`ai-msg ${t.role}`}>
            {t.content}
          </div>
        ))}
        {streamText !== null && <div className="ai-msg assistant">{streamText || '...'}</div>}
        <div ref={endRef} />
      </div>
      <div className="ai-chat-input">
        <textarea
          rows={2}
          placeholder="Ask about this pick, waiting, risks..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(input);
            }
          }}
          disabled={busy}
        />
        <button className="secondary" onClick={() => void ask(input)} disabled={busy || !input.trim()}>
          Ask
        </button>
      </div>
      {history.length > 0 && (
        <button className="link" onClick={() => setHistory([])} disabled={busy}>
          Clear conversation
        </button>
      )}
      {error && <p className="config-error">{error}</p>}
    </div>
  );
}
