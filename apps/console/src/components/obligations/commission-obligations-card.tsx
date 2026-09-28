import { cn, EmptyState, Icon } from '@adili/ui';
import { AlertCircleIcon, Calendar03Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type {
  CommissionObligationsSummary,
  DeclarationsResult,
} from '../../server/declarations/client';
import { formatDate, formatNumber } from '../format';
import { SectionCard } from '../page';
import { messages as m, OBLIGATION_STATUS_LABELS } from './messages';
import { cycleLabel, notOnboardedCount } from './obligations-query';

export interface CommissionObligationsCardProps {
  /** The Commission's counts; null when not loaded. */
  summary: DeclarationsResult<CommissionObligationsSummary>;
  /** "Obligations", to the Commission's officer list, for platform admins only. */
  link?: ReactNode;
  className?: string;
}

/**
 * The Commission detail's obligations card (spec 04 FE-4) for platform admins and EACC: the
 * cycle, then Upcoming, Due, Overdue and officers due or overdue who have not onboarded. Counts
 * only, no officer.
 */
export function CommissionObligationsCard({
  summary,
  link,
  className,
}: CommissionObligationsCardProps) {
  const counts = summary.ok ? summary.data : null;
  const empty =
    counts !== null &&
    counts.total.upcoming + counts.total.due + counts.total.overdue + counts.total.filed === 0;
  return (
    <SectionCard
      id="obligations"
      icon={Calendar03Icon}
      title={m.title}
      description={
        counts
          ? m.cardCycle(cycleLabel(counts.cycle.key), formatDate(counts.cycle.dueDate))
          : undefined
      }
      className={className}
    >
      {!counts ? (
        <p className="flex items-start gap-2 px-5 py-4 text-sm text-muted-foreground">
          <Icon icon={AlertCircleIcon} className="mt-0.5 size-4 shrink-0" />
          <span>{m.cardError}</span>
        </p>
      ) : empty ? (
        <EmptyState
          icon={<Icon icon={Calendar03Icon} />}
          title={m.emptyTitle}
          description={m.emptyText}
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2.5 p-5">
            <Count label={OBLIGATION_STATUS_LABELS.upcoming} value={counts.total.upcoming} />
            <Count label={OBLIGATION_STATUS_LABELS.due} value={counts.total.due} />
            <Count
              label={OBLIGATION_STATUS_LABELS.overdue}
              value={counts.total.overdue}
              warn={counts.total.overdue > 0}
            />
            <Count
              label={m.cardNotOnboarded}
              title={m.cardNotOnboardedHint}
              value={notOnboardedCount(counts)}
            />
          </dl>
          {link ? <div className="flex justify-end border-t px-5 py-3.5">{link}</div> : null}
        </>
      )}
    </SectionCard>
  );
}

function Count({
  label,
  value,
  warn = false,
  title,
}: {
  label: string;
  value: number;
  warn?: boolean;
  title?: string;
}) {
  return (
    <div
      title={title}
      className={cn(
        'grid min-w-0 gap-1 rounded-xl px-3.5 py-3',
        warn ? 'bg-warning-subtle' : 'bg-muted',
      )}
    >
      <dt
        className={cn(
          'text-[13px] font-medium',
          warn ? 'text-warning-subtle-foreground' : 'text-muted-foreground',
        )}
      >
        {label}
      </dt>
      <dd className="text-[22px] leading-tight font-semibold tracking-[-0.02em] tabular-nums">
        {formatNumber(value)}
      </dd>
    </div>
  );
}
