import { useEffect, useState } from 'react';
import { BRIDGE_STALE_MS, type EspnClockState, type LiveSyncState } from '../store';

/**
 * True when the ESPN bridge has gone silent (closed tab, dropped socket,
 * missing extension). Re-evaluated every few seconds; the extension
 * heartbeats at least every 5s while the draft socket lives.
 */
export function useBridgeStale(liveSync: LiveSyncState | null): boolean {
  const [, force] = useState(0);
  const active = liveSync?.sourceId === 'espn-bridge' && liveSync.status !== 'complete';
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => force((n) => n + 1), 4000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active || !liveSync) return false;
  return liveSync.lastSyncAt !== null && Date.now() - liveSync.lastSyncAt > BRIDGE_STALE_MS;
}

/** Seconds left on the ESPN pick clock, extrapolated locally between ticks. */
export function useEspnCountdown(clock: EspnClockState | null): number | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!clock || clock.msRemaining === null) return;
    const timer = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [clock]);
  if (!clock || clock.msRemaining === null) return null;
  const elapsed = Date.now() - clock.at;
  return Math.max(0, Math.round((clock.msRemaining - elapsed) / 1000));
}

export function formatClock(seconds: number | null): string {
  if (seconds === null) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function EspnCountdown({ clock }: { clock: EspnClockState | null }) {
  const seconds = useEspnCountdown(clock);
  if (seconds === null) return null;
  return (
    <span className={`espn-clock ${clock?.yourTurn ? 'your-turn' : ''} ${seconds <= 10 ? 'urgent' : ''}`}>
      {clock?.yourTurn ? 'YOUR PICK · ' : ''}
      {formatClock(seconds)}
    </span>
  );
}
