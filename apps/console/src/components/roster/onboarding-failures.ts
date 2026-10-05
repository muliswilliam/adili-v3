import type { OnboardingFailures } from '../../server/directory/client';

/** An hour with failed onboarding attempts, and its bar's length against the busiest hour. */
export interface FailureHour {
  windowStart: string;
  failedAttempts: number;
  /** Whole percent of the busiest hour's count, at least 1 so the bar shows. */
  share: number;
}

/** The last 24 hours of failed onboarding attempts, as the console shows them (story 30). */
export interface FailureBreakdown {
  since: string;
  total: number;
  /** Hours with failed attempts, latest first. */
  hours: FailureHour[];
  /** The busiest hour (the latest of equal ones), or null when nothing failed. */
  peak: { windowStart: string; failedAttempts: number } | null;
}

/** Shapes the directory's hourly counts for the drill-down: latest first, sized to the peak. */
export function failureBreakdown(view: OnboardingFailures): FailureBreakdown {
  const latestFirst = [...view.hours].sort((a, b) => b.windowStart.localeCompare(a.windowStart));
  const peak = latestFirst.reduce<FailureBreakdown['peak']>(
    (busiest, hour) =>
      busiest && busiest.failedAttempts >= hour.failedAttempts
        ? busiest
        : { windowStart: hour.windowStart, failedAttempts: hour.failedAttempts },
    null,
  );
  return {
    since: view.since,
    total: view.failedAttempts,
    hours: latestFirst.map((hour) => ({
      ...hour,
      share: peak ? Math.max(1, Math.round((hour.failedAttempts / peak.failedAttempts) * 100)) : 0,
    })),
    peak,
  };
}
