import {
  Button,
  Icon,
  obligationStatusMeta,
  obligationTypeNames,
  Skeleton,
  StatTile,
} from '@adili/ui';
import { UserRemove01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import type { CommissionObligationsSummary } from '../../server/declarations/client';
import { messages as m } from './messages';
import {
  notOnboardedCount,
  OBLIGATION_FILTER_STATUSES,
  OBLIGATION_TYPES,
  type ObligationFilterStatus,
  type ObligationsSearch,
  toggleStatus,
} from './obligations-query';

/** The dot before a status tile's label: the colour of its badge. */
const DOTS: Record<ObligationFilterStatus, string> = {
  upcoming: 'bg-input',
  due: 'bg-info',
  overdue: 'bg-warning',
};

const GRID = 'grid grid-cols-2 gap-3 min-[980px]:grid-cols-4';

export interface SummaryTilesProps {
  /** Null while it loads. */
  summary: CommissionObligationsSummary | null;
  search: ObligationsSearch;
  onSearchChange: (next: ObligationsSearch) => void;
}

/**
 * Upcoming, Due and Overdue for the Commission with their split by type, each a toggle that
 * filters the list by its status, then the declarants due or overdue who have not onboarded.
 */
export function SummaryTiles({ summary, search, onSearchChange }: SummaryTilesProps) {
  if (!summary) return <SummaryTilesSkeleton />;
  const notOnboarded = notOnboardedCount(summary);
  return (
    <div role="group" aria-label={m.summaryLabel} className={GRID}>
      {OBLIGATION_FILTER_STATUSES.map((status) => {
        const label = obligationStatusMeta[status].label;
        return (
          <StatTile
            key={status}
            label={label}
            value={summary.total[status]}
            marker={<span aria-hidden="true" className={`size-2 rounded-full ${DOTS[status]}`} />}
            breakdown={OBLIGATION_TYPES.map((type) => ({
              label: obligationTypeNames[type],
              value: summary.byType[type][status],
            }))}
            breakdownLabel={m.byType(label)}
            pressed={search.status === status}
            onPressedChange={() => {
              onSearchChange(toggleStatus(search, status));
            }}
          />
        );
      })}
      <StatTile
        label={m.notOnboardedTile}
        value={notOnboarded}
        marker={<Icon icon={UserRemove01Icon} />}
        tone={notOnboarded > 0 ? 'warning' : 'default'}
        breakdown={[
          { label: obligationStatusMeta.due.label, value: summary.notOnboarded.due },
          { label: obligationStatusMeta.overdue.label, value: summary.notOnboarded.overdue },
        ]}
        breakdownLabel={m.notOnboardedBreakdown}
      />
    </div>
  );
}

function SummaryTilesSkeleton() {
  return (
    <div aria-busy="true" aria-label={m.summaryLabel} role="group" className={GRID}>
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-2xl bg-card p-4 shadow-card">
          <Skeleton className="w-1/2" />
          <Skeleton className="my-1 h-6 w-1/3" />
          <Skeleton className="w-4/5" />
          <Skeleton className="w-3/4" />
        </div>
      ))}
    </div>
  );
}

export interface NotOnboardedCalloutProps {
  summary: CommissionObligationsSummary;
  /** "View roster", to the roster records filtered to not onboarded, for those who may open it. */
  rosterLink?: ReactNode;
  /** Filters the list below to declarants who have not onboarded. */
  onShowInList: () => void;
}

/**
 * Declarants with a declaration due who have not onboarded get no reminders from Adili: the
 * Commission is told to chase them itself, with a way to the roster. Hidden when there are none.
 */
export function NotOnboardedCallout({
  summary,
  rosterLink,
  onShowInList,
}: NotOnboardedCalloutProps) {
  const count = notOnboardedCount(summary);
  if (count === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-warning-subtle py-2.5 pr-3 pl-4 text-sm text-warning-subtle-foreground"
    >
      <Icon icon={UserRemove01Icon} className="size-4.5 shrink-0" />
      <p className="min-w-60 flex-1">{m.notOnboardedCallout(count)}</p>
      <div className="ml-auto flex flex-wrap gap-2">
        {rosterLink}
        <Button type="button" variant="ghost" size="sm" onClick={onShowInList}>
          {m.showInList}
        </Button>
      </div>
    </div>
  );
}
