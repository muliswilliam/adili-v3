import { cn, focusRing, formatDateTime, formatTime, Icon } from '@adili/ui';
import { AlertCircleIcon, ArrowDown01Icon, UserBlock01Icon } from '@hugeicons/core-free-icons';

import { formatNumber } from '../format';
import { SectionCard } from '../page';
import type { DirectoryResult, OnboardingFailures } from '../../server/directory/client';
import { messages as m } from './messages';
import { failureBreakdown } from './onboarding-failures';

const HOUR_MS = 60 * 60 * 1000;

/** `1 Oct 2026, 12:00–13:00`, the hour a count covers, in Kenyan time. */
function hourLabel(windowStart: string): string {
  return m.failuresHour(formatDateTime(windowStart), formatTime(Date.parse(windowStart) + HOUR_MS));
}

/**
 * Failed onboarding attempts against a Commission in the last 24 hours (spec 03, story 30): the
 * total, what counts, the busiest hour and a drill-down by hour. Counts only; the directory keeps
 * no identifiers or reasons per attempt.
 */
export function OnboardingFailuresCard({
  result,
  className,
}: {
  result: DirectoryResult<OnboardingFailures>;
  className?: string;
}) {
  return (
    <SectionCard
      id="onboarding-failures"
      icon={UserBlock01Icon}
      title={m.failuresTitle}
      description={m.failuresWindow}
      className={className}
    >
      {result.ok ? (
        <Failures failures={result.data} />
      ) : (
        <p className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Icon icon={AlertCircleIcon} className="mt-0.5 size-4 shrink-0" />
          <span>{m.failuresError}</span>
        </p>
      )}
    </SectionCard>
  );
}

function Failures({ failures }: { failures: OnboardingFailures }) {
  const breakdown = failureBreakdown(failures);
  return (
    <div className="grid gap-3 p-5">
      <p className="text-[26px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
        {formatNumber(breakdown.total)}
      </p>
      <p className="text-[13.5px] text-pretty text-muted-foreground">{m.failuresWhat}</p>
      {breakdown.peak ? (
        <p className="text-sm font-medium" suppressHydrationWarning>
          {m.failuresPeak(hourLabel(breakdown.peak.windowStart), breakdown.peak.failedAttempts)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{m.failuresNone}</p>
      )}
      {breakdown.hours.length > 0 ? (
        <details className="group rounded-lg shadow-control">
          <summary
            className={cn(
              focusRing,
              'flex cursor-pointer list-none items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden',
            )}
          >
            {m.failuresByHour}
            <Icon
              icon={ArrowDown01Icon}
              className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <ul aria-label={m.failuresByHourList} className="border-t">
            {breakdown.hours.map((hour) => (
              <li
                key={hour.windowStart}
                className="grid items-center gap-x-3 gap-y-1 border-t px-3.5 py-2 text-[13.5px] first:border-t-0 min-[520px]:grid-cols-[minmax(0,1fr)_120px_auto]"
              >
                <span className="tabular-nums" suppressHydrationWarning>
                  {hourLabel(hour.windowStart)}
                </span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-foreground"
                    style={{ width: `${hour.share}%` }}
                  />
                </span>
                <span className="text-right font-medium tabular-nums">
                  {m.failuresAttempts(hour.failedAttempts)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
