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
import { parseEspnPlayers } from './data/sources/espn';
import { currentSeason } from './data/sources/types';
import { sleeperDraftSource } from './draft/sources/sleeper';
import { buildSyncedDraft } from './draft/sources/sync';
import type { ExternalDraftInfo, ExternalPick } from './draft/sources/types';

const SAVE_KEY = 'footbud.save.v1';
const AI_KEY = 'footbud.ai.v1';
const SYNC_POLL_MS = 5000;

export interface EspnClockState {
  /** True when the ESPN draft socket says our team is on the clock. */
  yourTurn: boolean;
  /** Pick clock ms remaining as of `at` (extrapolate locally for display). */
  msRemaining: number | null;
  at: number;
}

export interface LiveSyncState {
  sourceId: 'sleeper' | 'espn-bridge';
  sourceLabel: string;
  draftId: string;
  status: 'polling' | 'paused' | 'complete';
  lastSyncAt: number | null;
  pickCount: number;
  error: string | null;
  warnings: string[];
  espnClock: EspnClockState | null;
  /** A pick sent to ESPN that has not been acknowledged yet. */
  pickPending: { playerName: string; at: number } | null;
}

/** How long without any bridge message before the ESPN feed counts as dead. */
export const BRIDGE_STALE_MS = 20000;

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
  /** Submit a pick in the ESPN draft room via the bridge extension. */
  sendEspnPick: (playerName: string, position: string) => void;
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
          espnClock: null,
          pickPending: null,
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
          lastSyncAt: Date.now(),
          pickCount: 0,
          error: null,
          warnings: [],
          espnClock: null,
          pickPending: null,
        },
      });
      startEspnBridgeListener();
      // Pull ESPN's own projections/ADP through the extension; when the
      // payload lands the pool swaps and the board rebuilds on it.
      requestEspnProjections();
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

  sendEspnPick: (playerName, position) => {
    const { liveSync } = get();
    if (!liveSync || liveSync.sourceId !== 'espn-bridge') return;
    if (!liveSync.espnClock?.yourTurn) {
      set({ lastError: 'It is not your turn in the ESPN draft room yet.' });
      return;
    }
    if (liveSync.lastSyncAt !== null && Date.now() - liveSync.lastSyncAt > BRIDGE_STALE_MS) {
      set({
        lastError:
          'The ESPN connection looks dead — make this pick in the ESPN tab, then check the extension.',
      });
      return;
    }
    if (liveSync.pickPending) return; // one in flight at a time
    const pending = { playerName, at: Date.now() };
    set({ liveSync: { ...liveSync, pickPending: pending } });
    window.postMessage(
      { source: 'footbud-app', type: 'make-pick', playerName, position },
      window.location.origin,
    );
    // If nothing acknowledges the pick quickly, tell the user to act in the
    // ESPN tab instead of letting the clock run out on a silent failure.
    setTimeout(() => {
      const current = get().liveSync;
      if (current?.pickPending && current.pickPending.at === pending.at) {
        set({
          liveSync: { ...current, pickPending: null },
          lastError: `No response from the ESPN draft room for ${playerName} — make the pick in the ESPN tab.`,
        });
      }
    }, 3000);
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

/** Last authoritative pick list, kept so a pool swap can force a rebuild. */
let lastExternalPicks: ExternalPick[] = [];
let lastPickFingerprint = '';

/** Rebuild the draft from an authoritative external pick list. */
function applyExternalPicks(picks: ExternalPick[], force = false): void {
  lastExternalPicks = picks;
  const { config, players, strategy, liveSync, draft } = useAppStore.getState();
  if (!liveSync) return;
  // Skip rebuild only when the CONTENT is unchanged — same-length lists can
  // still carry corrections (a fixed pick, better attribution), and the
  // platform is always the authority.
  const fingerprint = JSON.stringify(picks.map((p) => [p.overall, p.slot, p.playerName]));
  if (!force && draft && fingerprint === lastPickFingerprint && liveSync.lastSyncAt !== null) {
    useAppStore.setState({ liveSync: { ...liveSync, lastSyncAt: Date.now(), error: null } });
    return;
  }
  lastPickFingerprint = fingerprint;
  const { state, warnings } = buildSyncedDraft(config, players, picks);
  persist(state, strategy);
  const complete = state.complete;
  if (complete) stopPolling();
  // Keep non-sync warnings (projections failures, slot corrections) alive
  // across rebuilds; sync warnings refresh each time.
  const kept = liveSync.warnings.filter((w) => !w.includes('placeholder') && !w.includes('numbering gap'));
  const merged = [...new Set([...kept, ...warnings])].slice(-8);
  useAppStore.setState({
    draft: state,
    liveSync: {
      ...liveSync,
      status: complete ? 'complete' : liveSync.status,
      lastSyncAt: Date.now(),
      pickCount: picks.length,
      error: null,
      warnings: merged,
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
  status?: {
    yourTurn?: boolean;
    msRemaining?: number | null;
    at?: number;
    mySlot?: number | null;
    numberingDegraded?: boolean;
  };
  pickResult?: { ok?: boolean; reason?: string | null; playerName?: string };
  projections?: unknown;
  projectionsSeason?: number;
  projectionsError?: string | null;
}

/** Ask the bridge extension for ESPN's projections + ADP payload. */
export function requestEspnProjections(): void {
  window.postMessage(
    { source: 'footbud-app', type: 'request-projections', season: currentSeason() },
    window.location.origin,
  );
}

function appendWarning(warning: string): void {
  const current = useAppStore.getState().liveSync;
  if (!current || current.warnings.includes(warning)) return;
  useAppStore.setState({ liveSync: { ...current, warnings: [...current.warnings, warning] } });
}

let bridgeListener: ((event: MessageEvent) => void) | null = null;

function startEspnBridgeListener(): void {
  stopEspnBridgeListener();
  bridgeListener = (event: MessageEvent) => {
    // Only this page, from this page's own origin: an embedded cross-origin
    // iframe must not be able to forge picks, status, or projections.
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data as BridgeMessage;
    if (!data || data.source !== 'footbud-espn-bridge') return;
    let current = useAppStore.getState().liveSync;
    if (!current || current.sourceId !== 'espn-bridge') return;

    // Every bridge message is proof of life; staleness is measured from here.
    useAppStore.setState({ liveSync: { ...current, lastSyncAt: Date.now() } });
    current = useAppStore.getState().liveSync!;

    // Outcome of a pick submitted from FootBud.
    if (data.pickResult && typeof data.pickResult === 'object') {
      const ok = data.pickResult.ok === true;
      useAppStore.setState({
        liveSync: { ...current, pickPending: null },
        ...(ok
          ? {}
          : {
              lastError:
                data.pickResult.reason ??
                `The pick for ${data.pickResult.playerName ?? 'the player'} failed — make it in the ESPN tab.`,
            }),
      });
      return;
    }

    // ESPN projections payload fetched by the extension with the user's
    // session: swap in the real pool and rebuild the synced board on it.
    if (data.projections !== undefined) {
      if (!data.projections) {
        if (data.projectionsError) {
          useAppStore.setState({
            liveSync: { ...current, warnings: [...current.warnings, `ESPN projections: ${data.projectionsError}`] },
          });
        }
        return;
      }
      try {
        const season = typeof data.projectionsSeason === 'number' ? data.projectionsSeason : currentSeason();
        const parsed = parseEspnPlayers(data.projections, useAppStore.getState().config.scoringFormat, season);
        useAppStore.getState().setPlayers(parsed.players, 'ESPN projections (via extension)');
        applyExternalPicks(lastExternalPicks, true);
      } catch (e) {
        useAppStore.setState({
          liveSync: {
            ...current,
            warnings: [...current.warnings, `ESPN projections: ${e instanceof Error ? e.message : e}`],
          },
        });
      }
      return;
    }

    // Clock/turn status from the draft socket.
    if (data.status && typeof data.status === 'object') {
      useAppStore.setState({
        liveSync: {
          ...current,
          espnClock: {
            yourTurn: data.status.yourTurn === true,
            msRemaining:
              typeof data.status.msRemaining === 'number' ? data.status.msRemaining : null,
            at: typeof data.status.at === 'number' ? data.status.at : Date.now(),
          },
        },
      });
      if (data.status.numberingDegraded) {
        appendWarning(
          'ESPN pick numbering looked inconsistent; team attribution on the board may be off.',
        );
      }
      // ESPN's round-1 order is the authority on your draft slot. Correct a
      // wrong hand-entered slot and rebuild so every horizon is right.
      const mySlot = data.status.mySlot;
      const { config } = useAppStore.getState();
      if (
        typeof mySlot === 'number' &&
        Number.isInteger(mySlot) &&
        mySlot >= 1 &&
        mySlot <= config.numberOfTeams &&
        mySlot !== config.userDraftSlot
      ) {
        useAppStore.getState().setConfig({ ...config, userDraftSlot: mySlot });
        appendWarning(
          `Draft position corrected to ${mySlot} (from ESPN's round-1 order); recommendations now plan your real picks.`,
        );
        applyExternalPicks(lastExternalPicks, true);
      }
      return;
    }

    if (!Array.isArray(data.picks)) return;
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
