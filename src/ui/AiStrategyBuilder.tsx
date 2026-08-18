import { useEffect, useRef, useState } from 'react';
import { getAiProvider, useAppStore } from '../store';
import type { ChatTurn, StrategyDocument } from '../ai/provider';
import { toDraftStrategy, type AiStrategyOutput } from '../ai/schemas';
import type { DraftStrategy } from '../strategy/types';

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface Preview {
  output: AiStrategyOutput;
  strategy: DraftStrategy;
}

export function AiKeySettings() {
  const aiApiKey = useAppStore((s) => s.aiApiKey);
  const setAiApiKey = useAppStore((s) => s.setAiApiKey);
  const [draft, setDraft] = useState(aiApiKey);

  return (
    <div className="ai-key">
      <label>
        Anthropic API key
        <input
          type="password"
          placeholder="sk-ant-..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setAiApiKey(draft.trim())}
        />
      </label>
      <p className="hint">
        Powers the AI strategy builder and the in-draft assistant. The key is stored only in this
        browser and sent only to the Claude API. Get one at console.anthropic.com.
      </p>
    </div>
  );
}

export function AiStrategyBuilder() {
  const config = useAppStore((s) => s.config);
  const players = useAppStore((s) => s.players);
  const setConfig = useAppStore((s) => s.setConfig);
  const setStrategy = useAppStore((s) => s.setStrategy);
  const aiApiKey = useAppStore((s) => s.aiApiKey);

  const [mode, setMode] = useState<'closed' | 'chat' | 'preview'>('closed');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'chat' | 'build'>(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applySlot, setApplySlot] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [turns, streamText]);

  // Subscribing to aiApiKey keeps this component reactive to key changes;
  // getAiProvider itself reads the store non-reactively.
  const provider = aiApiKey.trim() ? getAiProvider() : null;
  const disabled = !provider;

  const startInterview = async () => {
    if (!provider) return;
    setMode('chat');
    setError(null);
    if (turns.length > 0) return; // resume existing conversation
    setBusy('chat');
    setStreamText('');
    try {
      const text = await provider.interviewTurn({ config, turns: [] }, (t) =>
        setStreamText((s) => (s ?? '') + t),
      );
      setTurns([{ role: 'assistant', content: text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStreamText(null);
      setBusy(false);
    }
  };

  const send = async () => {
    if (!provider || busy || input.trim() === '') return;
    const nextTurns: ChatTurn[] = [...turns, { role: 'user', content: input.trim() }];
    setTurns(nextTurns);
    setInput('');
    setBusy('chat');
    setStreamText('');
    setError(null);
    try {
      const text = await provider.interviewTurn({ config, turns: nextTurns }, (t) =>
        setStreamText((s) => (s ?? '') + t),
      );
      setTurns([...nextTurns, { role: 'assistant', content: text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTurns(turns); // roll back the unanswered user turn
      setInput(input);
    } finally {
      setStreamText(null);
      setBusy(false);
    }
  };

  const finalize = async (document?: StrategyDocument) => {
    if (!provider) return;
    setBusy('build');
    setError(null);
    try {
      const output = await provider.interpretStrategy({
        config,
        players,
        turns: document ? undefined : turns,
        document,
      });
      setPreview({ output, strategy: toDraftStrategy(output) });
      setMode('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (file: File) => {
    setError(null);
    const name = file.name.toLowerCase();
    if (name.endsWith('.pdf')) {
      const data = toBase64(await file.arrayBuffer());
      await finalize({ fileName: file.name, kind: 'pdf', data });
    } else if (name.endsWith('.txt') || name.endsWith('.md') || file.type.startsWith('text/')) {
      await finalize({ fileName: file.name, kind: 'text', data: await file.text() });
    } else {
      setError('Upload a .txt, .md, or .pdf file. For Word documents, save as PDF first.');
    }
  };

  const useStrategy = () => {
    if (!preview) return;
    setStrategy(preview.strategy);
    const slot = preview.output.draftSlotMentioned;
    if (
      applySlot &&
      slot !== null &&
      Number.isInteger(slot) &&
      slot >= 1 &&
      slot <= config.numberOfTeams &&
      slot !== config.userDraftSlot
    ) {
      setConfig({ ...config, userDraftSlot: slot });
    }
    setMode('closed');
    setPreview(null);
    setTurns([]);
  };

  const slotSuggestion =
    preview?.output.draftSlotMentioned != null &&
    preview.output.draftSlotMentioned >= 1 &&
    preview.output.draftSlotMentioned <= config.numberOfTeams &&
    preview.output.draftSlotMentioned !== config.userDraftSlot
      ? preview.output.draftSlotMentioned
      : null;

  return (
    <div className="ai-builder">
      {mode === 'closed' && (
        <>
          <div className="button-row">
            <button className="secondary" onClick={startInterview} disabled={disabled || !!busy}>
              Build a strategy with AI
            </button>
            <button
              className="secondary"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || !!busy}
            >
              {busy === 'build' ? 'Reading your strategy...' : 'Upload a strategy'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.target.value = '';
              }}
            />
          </div>
          {disabled && (
            <p className="hint">Add your Anthropic API key below to enable the AI builder.</p>
          )}
        </>
      )}

      {mode === 'chat' && (
        <div className="ai-chat">
          <div className="ai-chat-log">
            {turns.map((t, i) => (
              <div key={i} className={`ai-msg ${t.role}`}>
                {t.content}
              </div>
            ))}
            {streamText !== null && <div className="ai-msg assistant">{streamText || '...'}</div>}
            <div ref={chatEndRef} />
          </div>
          <div className="ai-chat-input">
            <textarea
              rows={2}
              placeholder="Type your answer..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!!busy}
            />
            <div className="ai-chat-actions">
              <button className="secondary" onClick={send} disabled={!!busy || input.trim() === ''}>
                Send
              </button>
              <button
                className="primary"
                onClick={() => finalize()}
                disabled={!!busy || turns.filter((t) => t.role === 'user').length === 0}
              >
                {busy === 'build' ? 'Building...' : 'Build my strategy'}
              </button>
              <button className="link" onClick={() => setMode('closed')} disabled={!!busy}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'preview' && preview && (
        <div className="ai-preview">
          <h3>{preview.strategy.name}</h3>
          <p className="hint">{preview.strategy.description}</p>
          <div className="section-title">How I read your strategy</div>
          <ul>
            {preview.output.interpretationSummary.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {preview.strategy.playerNotes.length > 0 && (
            <>
              <div className="section-title">Player reads</div>
              <ul>
                {preview.strategy.playerNotes.map((n, i) => (
                  <li key={i}>
                    {n.stance === 'target' ? 'Target' : 'Avoid'}: {n.name}
                    {n.reason ? ` (${n.reason})` : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
          {slotSuggestion !== null && (
            <label className="ai-slot-suggestion">
              <input
                type="checkbox"
                checked={applySlot}
                onChange={(e) => setApplySlot(e.target.checked)}
              />
              Also set my draft slot to {slotSuggestion} (currently {config.userDraftSlot})
            </label>
          )}
          <div className="button-row">
            <button className="primary" onClick={useStrategy}>
              Use this strategy
            </button>
            <button
              className="secondary"
              onClick={() => setMode(turns.length > 0 ? 'chat' : 'closed')}
            >
              Back
            </button>
          </div>
          <p className="hint">
            You can fine-tune everything afterward under Advanced settings, or keep talking to the
            AI to adjust it.
          </p>
        </div>
      )}

      {error && <p className="config-error">{error}</p>}
    </div>
  );
}
