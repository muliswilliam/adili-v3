import { useEffect, useRef, useState } from 'react';

/** Seconds left on a countdown, ticking once a second, and a function to start one. */
export function useCountdown(initialSeconds = 0): [number, (seconds: number) => void] {
  const [until, setUntil] = useState<number | null>(() =>
    initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : null,
  );
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
  function start(seconds: number) {
    const started = Date.now();
    setNow(started);
    setUntil(started + seconds * 1000);
  }
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  return [left, start];
}

/** Whole seconds from now until an ISO time; 0 when it is absent, unreadable or past. */
export function secondsUntil(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.ceil((time - now) / 1000));
}

/** `75` → `1:15`. */
export function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Screen readers hear the countdown every 10 seconds; the ticks in between stay silent. */
const ANNOUNCE_EVERY = 10;

/**
 * What to announce when a countdown moves from `previous` to `current` seconds left, or null.
 * Announces when the countdown reaches or passes a 10-second step (50, 40, ... 0). Compares
 * ranges rather than exact values, so a tick skipped by a throttled background tab still
 * announces the step it passed.
 */
export function countdownAnnouncement(
  previous: number,
  current: number,
  describe: (seconds: number) => string,
): string | null {
  if (current >= previous) return null;
  // The highest step below `previous`.
  const step = Math.floor((previous - 1) / ANNOUNCE_EVERY) * ANNOUNCE_EVERY;
  return step >= current ? describe(current) : null;
}

/**
 * The text for a countdown's polite live region: it changes only at 10-second steps (see
 * `countdownAnnouncement`), so the wait can tick every second on screen without talking over
 * the user. A new, longer countdown clears the last announcement rather than leaving it stale.
 */
export function useCountdownAnnouncement(
  secondsLeft: number,
  describe: (seconds: number) => string,
): string {
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(secondsLeft);
  useEffect(() => {
    const message = countdownAnnouncement(previous.current, secondsLeft, describe);
    if (secondsLeft > previous.current) setAnnouncement('');
    previous.current = secondsLeft;
    if (message) setAnnouncement(message);
  }, [secondsLeft, describe]);
  return announcement;
}
