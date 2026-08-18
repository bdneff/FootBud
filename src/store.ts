import { create } from 'zustand';
import { DEFAULT_LEAGUE, type LeagueConfig } from './config/league';
import type { Player } from './data/player';
import { SAMPLE_SOURCE_NAME, samplePlayers } from './data/sampleData';
import {
  applyPick,
  createDraft,
  restoreDraft,
  serializeDraft,
  undoPick,
  type DraftState,
  type SavedDraft,
} from './draft/state';
import { DEFAULT_STRATEGY, STRATEGY_PRESETS } from './strategy/presets';
import { DraftStrategySchema, type DraftStrategy } from './strategy/types';

import { AnthropicProvider } from './ai/anthropic';
import type { AIProvider } from './ai/provider';

const SAVE_KEY = 'footbud.save.v1';
const AI_KEY = 'footbud.ai.v1';

export interface AppState {
  phase: 'setup' | 'draft';
  config: LeagueConfig;
  players: Player[];
  playerSourceName: string;
  strategy: DraftStrategy;
  draft: DraftState | null;
  lastError: string | null;
  aiApiKey: string;

  setConfig: (config: LeagueConfig) => void;
  setPlayers: (players: Player[], sourceName: string) => void;
  setStrategy: (strategy: DraftStrategy) => void;
  setAiApiKey: (key: string) => void;
  startDraft: () => void;
  makePick: (playerId: string) => void;
  undo: () => void;
  exitToSetup: () => void;
  dismissError: () => void;
  loadSavedDraft: () => boolean;
}

function loadAiKey(): string {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return '';
    return (JSON.parse(raw) as { apiKey?: string }).apiKey ?? '';
  } catch {
    return '';
  }
}

let cachedProvider: { key: string; provider: AIProvider } | null = null;

/** The active AI provider, or null when no API key is configured. */
export function getAiProvider(): AIProvider | null {
  const key = useAppStore.getState().aiApiKey.trim();
  if (!key) return null;
  if (!cachedProvider || cachedProvider.key !== key) {
    cachedProvider = { key, provider: new AnthropicProvider(key) };
  }
  return cachedProvider.provider;
}

export function hasSavedDraft(): boolean {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false;
  }
}

function persist(state: DraftState, strategy: DraftStrategy): void {
  try {
    const saved = {
      ...serializeDraft(state, new Date().toISOString()),
      strategy,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
  } catch {
    // Storage unavailable (private mode, quota): drafting still works.
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  phase: 'setup',
  config: DEFAULT_LEAGUE,
  players: samplePlayers(),
  playerSourceName: SAMPLE_SOURCE_NAME,
  strategy: DEFAULT_STRATEGY,
  draft: null,
  lastError: null,
  aiApiKey: loadAiKey(),

  setConfig: (config) => set({ config }),
  setPlayers: (players, playerSourceName) => set({ players, playerSourceName }),
  setStrategy: (strategy) => set({ strategy }),
  setAiApiKey: (aiApiKey) => {
    try {
      localStorage.setItem(AI_KEY, JSON.stringify({ apiKey: aiApiKey }));
    } catch {
      // Storage unavailable: the key still works for this session.
    }
    set({ aiApiKey });
  },

  startDraft: () => {
    const { config, players, strategy } = get();
    try {
      const draft = createDraft(config, players);
      persist(draft, strategy);
      set({ draft, phase: 'draft', lastError: null });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  makePick: (playerId) => {
    const { draft, strategy } = get();
    if (!draft) return;
    try {
      const next = applyPick(draft, playerId);
      persist(next, strategy);
      set({ draft: next, lastError: null });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  undo: () => {
    const { draft, strategy } = get();
    if (!draft) return;
    const next = undoPick(draft);
    persist(next, strategy);
    set({ draft: next });
  },

  exitToSetup: () => set({ phase: 'setup', draft: null }),

  dismissError: () => set({ lastError: null }),

  loadSavedDraft: () => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as SavedDraft & { strategy?: unknown };
      const draft = restoreDraft(parsed);
      const strategyResult = DraftStrategySchema.safeParse(parsed.strategy);
      const strategy = strategyResult.success
        ? strategyResult.data
        : (STRATEGY_PRESETS.find((s) => s.id === DEFAULT_STRATEGY.id) ?? DEFAULT_STRATEGY);
      set({
        draft,
        config: draft.config,
        players: [...draft.pool.values()],
        strategy,
        phase: 'draft',
        lastError: null,
      });
      return true;
    } catch (e) {
      set({ lastError: `Could not load saved draft: ${e instanceof Error ? e.message : e}` });
      return false;
    }
  },
}));
