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
import { sleeperDraftSource } from './draft/sources/sleeper';
import { buildSyncedDraft } from './draft/sources/sync';
import type { ExternalDraftInfo, ExternalPick } from './draft/sources/types';

const SAVE_KEY = 'footbud.save.v1';
const AI_KEY = 'footbud.ai.v1';
const SYNC_POLL_MS = 5000;

export interface LiveSyncState {
  sourceId: 'sleeper' | 'espn-bridge';
  sourceLabel: string;
  draftId: string;
  status: 'polling' | 'paused' | 'complete';
  lastSyncAt: number | null;
  pickCount: number;
  error: string | null;
  warnings: string[];
}

export interface AppState {
  phase: 'setup' | 'draft';
  config: LeagueConfig;
  players: Player[];
  playerSourceName: string;
  strategy: DraftStrategy;
  draft: DraftState | null;
  lastError: string | null;
  aiApiKey: string;
  liveSync: LiveSyncState | null;

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
  /** Start a Sleeper-synced draft from a resolved draft, polling for picks. */
  connectSleeperDraft: (info: ExternalDraftInfo, userSlot: number) => void;
  /** Start an ESPN-extension-linked draft with the current league config. */
  startEspnBridgeDraft: () => void;
  pauseLiveSync: () => void;
  resumeLiveSync: () => void;
  disconnectLiveSync: () => void;
  syncNow: () => Promise<void>;
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
  liveSync: null,

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
    const { draft, strategy, liveSync } = get();
    if (!draft) return;
    if (liveSync && liveSync.status !== 'complete') {
      set({ lastError: 'Picks arrive from the live sync. Disconnect it to enter picks manually.' });
      return;
    }
    try {
      const next = applyPick(draft, playerId);
      persist(next, strategy);
      set({ draft: next, lastError: null });
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  undo: () => {
    const { draft, strategy, liveSync } = get();
    if (!draft) return;
    if (liveSync && liveSync.status !== 'complete') {
      set({ lastError: 'The live sync controls this draft. Disconnect it to undo picks manually.' });
      return;
    }
    const next = undoPick(draft);
    persist(next, strategy);
    set({ draft: next });
  },

  exitToSetup: () => {
    get().disconnectLiveSync();
    set({ phase: 'setup', draft: null });
  },

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

  connectSleeperDraft: (info, userSlot) => {
    const { players, strategy } = get();
    const config: LeagueConfig = { ...info.config, userDraftSlot: userSlot };
    try {
      const draft = createDraft(config, players);
      persist(draft, strategy);
      set({
        config,
        draft,
        phase: 'draft',
        lastError: null,
        liveSync: {
          sourceId: 'sleeper',
          sourceLabel: 'Sleeper',
          draftId: info.draftId,
          status: 'polling',
          lastSyncAt: null,
          pickCount: 0,
          error: null,
          warnings: [],
        },
      });
      startPolling();
      void get().syncNow();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  startEspnBridgeDraft: () => {
    const { config, players, strategy } = get();
    try {
      const draft = createDraft(config, players);
      persist(draft, strategy);
      set({
        draft,
        phase: 'draft',
        lastError: null,
        liveSync: {
          sourceId: 'espn-bridge',
          sourceLabel: 'ESPN extension',
          draftId: 'espn',
          status: 'polling',
          lastSyncAt: null,
          pickCount: 0,
          error: null,
          warnings: [],
        },
      });
      startEspnBridgeListener();
    } catch (e) {
      set({ lastError: e instanceof Error ? e.message : String(e) });
    }
  },

  pauseLiveSync: () => {
    stopPolling();
    const { liveSync } = get();
    if (liveSync) set({ liveSync: { ...liveSync, status: 'paused' } });
  },

  resumeLiveSync: () => {
    const { liveSync } = get();
    if (!liveSync) return;
    set({ liveSync: { ...liveSync, status: 'polling' } });
    if (liveSync.sourceId === 'sleeper') {
      startPolling();
      void get().syncNow();
    }
  },

  disconnectLiveSync: () => {
    stopPolling();
    stopEspnBridgeListener();
    if (get().liveSync) set({ liveSync: null });
  },

  syncNow: async () => {
    const { liveSync } = get();
    if (!liveSync || liveSync.sourceId !== 'sleeper' || liveSync.status === 'paused') return;
    try {
      const picks = await sleeperDraftSource.fetchPicks(liveSync.draftId);
      applyExternalPicks(picks);
    } catch (e) {
      const current = get().liveSync;
      if (current) {
        set({
          liveSync: { ...current, error: e instanceof Error ? e.message : String(e) },
        });
      }
    }
  },
}));

/** Rebuild the draft from an authoritative external pick list. */
function applyExternalPicks(picks: ExternalPick[]): void {
  const { config, players, strategy, liveSync, draft } = useAppStore.getState();
  if (!liveSync) return;
  // Skip rebuild when nothing changed; rebuild otherwise so platform-side
  // corrections are absorbed.
  if (draft && liveSync.pickCount === picks.length && liveSync.lastSyncAt !== null) {
    useAppStore.setState({ liveSync: { ...liveSync, lastSyncAt: Date.now(), error: null } });
    return;
  }
  const { state, warnings } = buildSyncedDraft(config, players, picks);
  persist(state, strategy);
  const complete = state.complete;
  if (complete) stopPolling();
  useAppStore.setState({
    draft: state,
    liveSync: {
      ...liveSync,
      status: complete ? 'complete' : liveSync.status,
      lastSyncAt: Date.now(),
      pickCount: picks.length,
      error: null,
      warnings,
    },
  });
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    void useAppStore.getState().syncNow();
  }, SYNC_POLL_MS);
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * ESPN bridge: the companion browser extension posts picks it reads from
 * the ESPN draft room into this window. See extension/README.md.
 */
interface BridgeMessage {
  source?: string;
  picks?: unknown[];
}

let bridgeListener: ((event: MessageEvent) => void) | null = null;

function startEspnBridgeListener(): void {
  stopEspnBridgeListener();
  bridgeListener = (event: MessageEvent) => {
    const data = event.data as BridgeMessage;
    if (!data || data.source !== 'footbud-espn-bridge' || !Array.isArray(data.picks)) return;
    const { liveSync } = useAppStore.getState();
    if (!liveSync || liveSync.sourceId !== 'espn-bridge' || liveSync.status === 'paused') return;
    const picks: ExternalPick[] = [];
    for (const raw of data.picks) {
      const p = raw as Partial<ExternalPick>;
      if (typeof p.overall !== 'number' || typeof p.playerName !== 'string') continue;
      picks.push({
        overall: p.overall,
        slot: typeof p.slot === 'number' ? p.slot : 0,
        playerName: p.playerName,
        position: (p.position as ExternalPick['position']) ?? null,
        team: typeof p.team === 'string' ? p.team : null,
        externalPlayerId: null,
      });
    }
    picks.sort((a, b) => a.overall - b.overall);
    applyExternalPicks(picks);
  };
  window.addEventListener('message', bridgeListener);
}

function stopEspnBridgeListener(): void {
  if (bridgeListener) {
    window.removeEventListener('message', bridgeListener);
    bridgeListener = null;
  }
}
