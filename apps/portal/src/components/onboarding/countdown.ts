import { useEffect, useState } from 'react';

/** Seconds left on a countdown, ticking once a second, and a function to start one. */
export function useCountdown(initialSeconds = 0): [number, (seconds: number) => void] {
  const [until, setUntil] = useState<number | null>(() =>
    initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : null,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [until]);
  function start(seconds: number) {
    const started = Date.now();
    setNow(started);
    setUntil(started + seconds * 1000);
  }
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return [left, start];
}

/** Whole seconds from now until an ISO time, never negative. */
export function secondsUntil(iso: string | null, now = Date.now()): number {
  if (iso === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The coarse steps a screen reader hears; every other tick stays silent. */
const ANNOUNCED_AT = [120, 60, 30, 10, 0];

/**
 * What to announce when a countdown moves from `previous` to `current` seconds left, or null.
 * Compares ranges rather than exact values, so a tick skipped by a throttled background tab
 * still announces the step it passed.
 */
export function countdownAnnouncement(
  previous: number,
  current: number,
  describe: (seconds: number) => string,
): string | null {
  if (current >= previous) return null;
  const step = ANNOUNCED_AT.find((mark) => previous > mark && current <= mark);
  return step === undefined ? null : describe(current);
}
