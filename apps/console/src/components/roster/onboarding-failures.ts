import type { OnboardingFailures } from '../../server/directory/client';

/** An hour's failed onboarding attempts, as the directory counts them. */
type FailureCount = OnboardingFailures['hours'][number];

/** An hour with failed onboarding attempts, and its bar's length against the busiest hour. */
export interface FailureHour extends FailureCount {
  /** Whole percent of the busiest hour's count, at least 1 so the bar shows. */
  share: number;
}

/** The last 24 hours of failed onboarding attempts, as the console shows them (story 30). */
export interface FailureBreakdown {
  failedAttempts: number;
  /** Hours with failed attempts, latest first. */
  hours: FailureHour[];
  /** The busiest hour (the latest of equal ones), or null when nothing failed. */
  peak: FailureCount | null;
}

/** Shapes the directory's hourly counts for the drill-down: latest first, sized to the peak. */
export function failureBreakdown(failures: OnboardingFailures): FailureBreakdown {
  const latestFirst = [...failures.hours].sort((a, b) =>
    b.windowStart.localeCompare(a.windowStart),
  );
  const peak = latestFirst.reduce<FailureCount | null>(
    (busiest, hour) => (busiest && busiest.failedAttempts >= hour.failedAttempts ? busiest : hour),
    null,
  );
  return {
    failedAttempts: failures.failedAttempts,
    hours: latestFirst.map((hour) => ({
      ...hour,
      share: peak ? Math.max(1, Math.round((hour.failedAttempts / peak.failedAttempts) * 100)) : 0,
    })),
    peak,
  };
}
