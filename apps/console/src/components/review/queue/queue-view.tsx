import { Card } from '@adili/ui';
import { useState } from 'react';

import type { CaseViewer } from '../../../review-case/view';
import { QUEUE_COPY as m } from '../../../review-queue/messages';
import type { QueueSearch } from '../../../review-queue/query';
import type { QueueSummary } from '../../../review-queue/rows';
import type { Reviewer } from '../../../server/review-case.server';
import type { QueuePage } from '../../../server/review-queue';
import type { ServiceResult } from '../../../server/service-call';
import { LoadError } from '../../load-error';
import { Page, PageHead } from '../../page';
import { useCaseAssignment } from '../assignment';
import { QueueResults, QueueResultsSkeleton } from './queue-results';
import { QueueTiles } from './queue-tiles';
import { QueueToolbar } from './queue-toolbar';

export interface QueueViewProps {
  /** The Commission's name, for the heading; null while it loads or when it is unknown. */
  commission: string | null;
  /** The counts behind the tiles; null while they load. */
  summary: ServiceResult<QueueSummary> | null;
  /** The first page for `search`; null while it loads. */
  list: ServiceResult<QueuePage> | null;
  search: QueueSearch;
  onSearchChange: (next: QueueSearch, options?: { replace?: boolean }) => void;
  viewer: CaseViewer & { name: string };
  /** The viewer's Commission. */
  slug: string | null;
  /** Statement years to filter by. */
  cycles: readonly number[];
  /** A supervisor's reviewers to filter by; null for reviewers or while they load. */
  reviewers: readonly Reviewer[] | null;
  /** The page's address, for Copy link. */
  href: string;
  loadPage: (cursor: string) => Promise<ServiceResult<QueuePage>>;
  /** Reloads the summary and the first page (after a claim or a reassignment). */
  refresh: () => Promise<void>;
}

/**
 * The review workspace of a Commission (spec 07a FE-2, `/review`): the summary tiles and the
 * overdue clarifications, then the filterable queue with Claim, Open and a supervisor's
 * Reassign, Assign and Unassign on each row. Filters live in the URL (S19), the search text in
 * the history entry.
 */
export function QueueView(props: QueueViewProps) {
  const { summary, list, search, onSearchChange, viewer, slug } = props;
  const listNumber = useLoadNumber(list);
  const items = list?.ok ? list.data.items : [];
  const assignment = useCaseAssignment({
    viewer,
    slug,
    refresh: props.refresh,
    find: (caseId) => items.find((item) => item.id === caseId),
  });
  const counts = summary?.ok ? summary.data : null;
  const bothFailed = summary !== null && !summary.ok && list !== null && !list.ok;

  return (
    <Page>
      <PageHead title={props.commission ? m.titleOf(props.commission) : m.title} />
      <div className="flex flex-col gap-3">
        {summary && !summary.ok ? (
          bothFailed ? null : (
            <LoadError title={m.summaryErrorTitle} detail={m.errorDetail} retryLabel={m.retry} />
          )
        ) : (
          <QueueTiles summary={counts} search={search} onSearchChange={onSearchChange} />
        )}
        <OverdueLine count={counts?.overdueClarifications ?? 0} />
        <Card className="@container overflow-hidden p-0 sm:p-0">
          <QueueToolbar
            search={search}
            onSearchChange={onSearchChange}
            cycles={props.cycles}
            reviewers={props.reviewers}
            href={props.href}
          />
          {list === null ? (
            <QueueResultsSkeleton />
          ) : (
            <QueueResults
              // A new first page (other filters, or a reload) starts the list again.
              key={listNumber}
              result={list}
              search={search}
              onSearchChange={onSearchChange}
              viewer={viewer}
              loadPage={props.loadPage}
              onAction={(action, item) => {
                assignment.start(action, { item, reviewerHistory: [] });
              }}
            />
          )}
        </Card>
      </div>
      {assignment.dialogs}
    </Page>
  );
}

/**
 * Counts the first pages loaded (each load is a new object), so "Load more" state resets with
 * each one.
 */
function useLoadNumber(list: ServiceResult<QueuePage> | null): number {
  const [seen, setSeen] = useState({ list, number: 0 });
  if (seen.list !== list) {
    const next = { list, number: seen.number + 1 };
    setSeen(next);
    return next.number;
  }
  return seen.number;
}

/** "2 clarifications overdue", when any are. */
function OverdueLine({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="flex items-center gap-2 text-[13.5px] font-semibold text-secondary-foreground">
      <span aria-hidden="true" className="size-2 rounded-full bg-destructive" />
      {m.overdue(count)}
    </p>
  );
}
