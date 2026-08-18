import { useEffect, useState } from 'react';
import type { EspnClockState } from '../store';

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
