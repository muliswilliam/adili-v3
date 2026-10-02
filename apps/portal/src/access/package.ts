import { calendarDaysUntil, GRANTED_ACCESS_STATUSES } from '@adili/ui';

import type { AccessRequest, Package } from '../server/access/types';
import { PACKAGE_COPY as COPY } from './copy';

/**
 * Where a granted request's package stands for the applicant (spec 10, #261): still being
 * prepared, ready to download until its window ends, or past its window. Pure, from the request
 * and a clock, so the page, the list and the progress agree.
 */

/** From this long before the window ends, the page counts down in hours and minutes. */
export const COUNTDOWN_FROM_MS = 24 * 3_600_000;

export type PackageView =
  /** Granted, and the package is not issued yet. */
  | { state: 'preparing' }
  | {
      state: 'ready';
      package: Package;
      /** The latest registered download, if any. */
      lastDownloadAt: string | null;
      /** Milliseconds until the window ends; positive. */
      msLeft: number;
      /** Calendar days in Kenyan time until the window's last day: 0 on that day. */
      daysLeft: number;
    }
  | { state: 'expired'; package: Package; lastDownloadAt: string | null };

/**
 * The package of a granted or partially granted request at `now`; null for any other status.
 * `windowClosed` is the documents service's word (410) that the window has ended, which wins
 * over the clock, as the browser's clock may run behind.
 */
export function packageView(
  request: Pick<AccessRequest, 'status' | 'package' | 'timeline'>,
  now: number,
  windowClosed = false,
): PackageView | null {
  if (!GRANTED_ACCESS_STATUSES.has(request.status)) return null;
  const pkg = request.package;
  if (!pkg) return { state: 'preparing' };
  const lastDownloadAt =
    request.timeline.filter((entry) => entry.kind === 'downloaded').at(-1)?.at ?? null;
  const msLeft = Date.parse(pkg.downloadExpiresAt) - now;
  if (msLeft <= 0) return { state: 'expired', package: pkg, lastDownloadAt };
  if (windowClosed) {
    // Closed before the time the page had: it ended by now.
    const closed = { ...pkg, downloadExpiresAt: new Date(now).toISOString() };
    return { state: 'expired', package: closed, lastDownloadAt };
  }
  return {
    state: 'ready',
    package: pkg,
    lastDownloadAt,
    msLeft,
    daysLeft: calendarDaysUntil(pkg.downloadExpiresAt, now),
  };
}

/** `5 h 12 min`, `12 min`: the time left, at least a minute while any is left. */
export function countdownText(msLeft: number): string {
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/**
 * What a screen reader hears of the countdown: hours left, then in the last hour ten-minute
 * steps and the last minutes, so the live region changes at coarse steps, not every minute.
 */
export function countdownSpoken(msLeft: number): string {
  const minutes = Math.max(1, Math.ceil(msLeft / 60_000));
  if (minutes > 50) return COPY.spokenHours(Math.ceil(minutes / 60));
  if (minutes > 10) return COPY.spokenMinutes(Math.ceil(minutes / 10) * 10);
  return COPY.spokenMinutes(minutes);
}
