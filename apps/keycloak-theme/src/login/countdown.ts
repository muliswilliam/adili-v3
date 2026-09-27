import { useEffect, useState } from 'react';

// Same rules as the portal's onboarding countdown (apps/portal/src/components/onboarding), kept
// here because the theme is a separate bundle.

/** Seconds left until `until` (epoch ms), ticking once a second. */
export function useSecondsUntil(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const done = until === null || until <= now;
  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [done]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/** Epoch ms of an ISO time, or null when absent or unreadable. */
export function parseInstant(iso: string | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
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
