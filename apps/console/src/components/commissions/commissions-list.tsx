import { Button, Card, EmptyState, Icon, Skeleton } from '@adili/ui';
import { Building03Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { Suspense, use, useEffect, useState } from 'react';

import {
  type CommissionFilters,
  type CommissionListSearch,
  filtersOf,
  hasFilters,
} from '../../lib/commission-filters';
import type { DirectoryFailure, DirectoryResult } from '../../server/directory/result';
import type { CommissionPage } from '../../server/directory/types';
import { Page, PageHead } from '../page';
import { ForbiddenAlert, LoadErrorAlert } from './alerts';
import { ReadOnlyBadge } from './badges';
import { CommissionsPager } from './commissions-pager';
import { CommissionsResults, CommissionsTableSkeleton } from './commissions-table';
import { CommissionsToolbar } from './commissions-toolbar';
import { messages } from './messages';
import { nextPage, type PageLocation, type Paging, pagingView, previousPage } from './paging';

export type CommissionsPageResult = DirectoryResult<CommissionPage>;

export interface CommissionsListProps {
  access: 'read' | 'write';
  search: CommissionListSearch;
  paging: Paging;
  /** The page for `search`; skeleton rows stand in for it until it arrives. */
  page: Promise<CommissionsPageResult>;
  /** New filters; the caller drops the cursor, since it belongs to the old results. */
  onFiltersChange: (filters: CommissionFilters) => void;
  onPageChange: (location: PageLocation) => void;
  onRetry: () => void;
  /** The session ended while the page was loading. */
  onSignedOut: () => void;
}

/**
 * The Commissions list: page head with the count, then one card with the toolbar and the table.
 * Only the count and the table wait for the directory, so the toolbar (and focus in the search
 * box) stays put while a filter change loads.
 */
export function CommissionsList(props: CommissionsListProps) {
  const { access, search, page, onFiltersChange } = props;
  // A new search or page shows skeletons again rather than the previous rows.
  const loadKey = JSON.stringify(search);
  const [refusedKey, setRefusedKey] = useState<string | null>(null);

  return (
    <Page>
      <PageHead title={messages.title} actions={access === 'read' ? <ReadOnlyBadge /> : null}>
        <div className="mt-1 text-sm text-muted-foreground">
          <Suspense
            key={loadKey}
            fallback={<Skeleton className="my-1 inline-block w-[110px] align-middle" />}
          >
            <CountLine page={page} paging={props.paging} />
          </Suspense>
        </div>
      </PageHead>
      <Card className="p-0 sm:p-0">
        <CommissionsToolbar
          filters={filtersOf(search)}
          disabled={refusedKey === loadKey}
          onChange={onFiltersChange}
        />
        <Suspense key={loadKey} fallback={<CommissionsTableSkeleton />}>
          <Results
            {...props}
            onRefused={() => {
              setRefusedKey(loadKey);
            }}
          />
        </Suspense>
      </Card>
    </Page>
  );
}

function CountLine({ page, paging }: { page: Promise<CommissionsPageResult>; paging: Paging }) {
  const result = use(page);
  if (!result.ok) return ' ';
  const view = pagingView(result.data, paging);
  return messages.count(view.count, { more: view.more });
}

function Results({
  search,
  paging,
  page,
  onFiltersChange,
  onPageChange,
  onRetry,
  onSignedOut,
  onRefused,
}: CommissionsListProps & { onRefused: () => void }) {
  const result = use(page);
  const failure = result.ok ? null : result.failure;
  useEffect(() => {
    if (failure?.kind === 'unauthenticated') onSignedOut();
    if (failure?.kind === 'forbidden') onRefused();
  }, [failure, onSignedOut, onRefused]);

  if (!result.ok) return <LoadFailure failure={result.failure} onRetry={onRetry} />;

  const view = pagingView(result.data, paging);
  if (result.data.items.length === 0) {
    return hasFilters(search) ? (
      <NoMatches
        onClear={() => {
          onFiltersChange({});
        }}
      />
    ) : (
      <NoCommissions />
    );
  }

  const next = nextPage(search, result.data, paging);
  return (
    <>
      <CommissionsResults commissions={result.data.items} />
      <CommissionsPager
        range={view.range}
        rows={result.data.items.length}
        hasPrevious={view.hasPrevious}
        hasNext={next !== null}
        onPrevious={() => {
          onPageChange(previousPage(search, paging));
        }}
        onNext={() => {
          if (next) onPageChange(next);
        }}
      />
    </>
  );
}

function LoadFailure({ failure, onRetry }: { failure: DirectoryFailure; onRetry: () => void }) {
  if (failure.kind === 'unauthenticated') return <CommissionsTableSkeleton />;
  return (
    <div className="p-5">
      {failure.kind === 'forbidden' ? (
        <ForbiddenAlert />
      ) : (
        <LoadErrorAlert title={messages.error.title} failure={failure} onRetry={onRetry} />
      )}
    </div>
  );
}

function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <EmptyState
      icon={<Icon icon={Search01Icon} />}
      title={messages.noMatches.title}
      text={messages.noMatches.text}
      action={
        <Button variant="secondary" size="sm" onClick={onClear}>
          {messages.filters.clearAll}
        </Button>
      }
    />
  );
}

/** "New Commission" joins this empty state with the create screen (#15). */
function NoCommissions() {
  return (
    <EmptyState
      icon={<Icon icon={Building03Icon} />}
      title={messages.empty.title}
      text={messages.empty.text}
    />
  );
}
