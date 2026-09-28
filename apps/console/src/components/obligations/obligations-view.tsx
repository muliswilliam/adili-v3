import { Badge, Card, EmptyState, Icon, Skeleton } from '@adili/ui';
import { Calendar03Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useState } from 'react';

import type {
  CommissionObligationsSummary,
  DeclarationsResult,
  ObligationDetail,
  ObligationListItem,
  ObligationPage,
  OfficerRef,
} from '../../server/declarations/client';
import { formatDate } from '../format';
import { LoadError, NoAccess } from '../load-error';
import { Page, PageHead } from '../page';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { ObligationDrawer } from './obligation-drawer';
import { ObligationsList } from './obligations-list';
import {
  cycleLabel,
  cycleOptions,
  type ObligationsSearch,
  showNotOnboarded,
} from './obligations-query';
import { NotOnboardedCallout, SummaryTiles } from './summary-tiles';

export interface ObligationsViewProps {
  /** The Commission's counts; null while they load. */
  summary: DeclarationsResult<CommissionObligationsSummary> | null;
  /** The first page of the list for `search`; null while it loads. */
  list: DeclarationsResult<ObligationPage> | null;
  search: ObligationsSearch;
  onSearchChange: (next: ObligationsSearch, options?: { replace?: boolean }) => void;
  loadPage: (cursor: string) => Promise<DeclarationsResult<ObligationPage>>;
  loadObligation: (id: string) => Promise<DeclarationsResult<ObligationDetail>>;
  /** The roster, for those who may open it: records not onboarded, and one officer's record. */
  roster?: {
    notOnboardedLink: ReactNode;
    recordLink: (officer: OfficerRef) => ReactNode;
  };
  /** Offered when the Commission has no obligations at all, e.g. "Import roster". */
  emptyAction?: ReactNode;
  /** Where to go when the officer list is not the viewer's to see (EACC staff). */
  forbiddenAction?: ReactNode;
  /** Where to go from a Commission that is not found. */
  notFoundAction?: ReactNode;
}

const problemStatus = (result: DeclarationsResult<unknown> | null) =>
  result && !result.ok && result.error.kind === 'problem' ? result.error.problem.status : null;

/**
 * The Obligations workspace of one Commission (spec 04 FE-3): the current cycle, summary tiles,
 * the not-onboarded callout, then the filterable list, with a drawer per obligation. EACC staff,
 * refused the list (403), are pointed to the counts on the Commission page; another Commission
 * reads as not found (404).
 */
export function ObligationsView(props: ObligationsViewProps) {
  const { summary, list, search, onSearchChange, roster } = props;
  const [open, setOpen] = useState<ObligationListItem | null>(null);

  if (problemStatus(list) === 403) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <NoAccess text={m.forbidden} action={props.forbiddenAction} />
      </Page>
    );
  }
  if (problemStatus(summary) === 404 || problemStatus(list) === 404) {
    return (
      <Page narrow>
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.notFoundTitle}
            description={m.notFoundText}
            action={props.notFoundAction}
          />
        </Card>
      </Page>
    );
  }

  const counts = summary?.ok ? summary.data : null;
  return (
    <Page>
      <PageHead title={m.title}>
        <CycleLine summary={summary} />
      </PageHead>
      <div className="flex flex-col gap-4">
        {summary && !summary.ok ? (
          <LoadError
            title={m.errorTitle}
            detail={
              summary.error.kind === 'unavailable' && summary.error.detail
                ? summary.error.detail
                : m.errorDetail
            }
            retryLabel={m.tryAgain}
          />
        ) : (
          <>
            <SummaryTiles summary={counts} search={search} onSearchChange={onSearchChange} />
            {counts ? (
              <NotOnboardedCallout
                summary={counts}
                rosterLink={roster?.notOnboardedLink}
                onShowInList={() => {
                  onSearchChange(showNotOnboarded(search));
                }}
              />
            ) : null}
          </>
        )}
        {/* With the counts failing too, one alert says it all. */}
        {summary && !summary.ok && list && !list.ok ? null : (
          <ObligationsList
            result={list}
            search={search}
            onSearchChange={onSearchChange}
            loadPage={props.loadPage}
            cycles={cycleOptions(counts, search.cycle)}
            onOpen={setOpen}
            emptyAction={props.emptyAction}
          />
        )}
      </div>
      <ObligationDrawer
        obligation={open}
        onClose={() => {
          setOpen(null);
        }}
        load={props.loadObligation}
        onUnauthenticated={goToSignIn}
        recordLink={roster?.recordLink}
      />
    </Page>
  );
}

/** "Public Service Commission · Biennial 2027 · statement 1 Nov 2027 · due 31 Dec 2027". */
function CycleLine({
  summary,
}: {
  summary: DeclarationsResult<CommissionObligationsSummary> | null;
}) {
  if (summary === null) {
    return <Skeleton className="mt-2 h-4 w-[360px] max-w-full" />;
  }
  if (!summary.ok) return null;
  const { commission, cycle } = summary.data;
  const opened = cycleOptions(summary.data, undefined)[0]?.opened ?? false;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-2 text-sm text-muted-foreground">
      <span>{commission.name}</span>
      <span aria-hidden="true" className="hidden size-1 rounded-full bg-input min-[700px]:block" />
      <span className="inline-flex items-center gap-2 font-medium text-secondary-foreground">
        <Icon icon={Calendar03Icon} className="size-[15px]" />
        {m.cycleLine(
          cycleLabel(cycle.key),
          formatDate(cycle.statementDate),
          formatDate(cycle.dueDate),
        )}
      </span>
      {opened ? null : (
        <Badge title={m.cycleNotOpenHint} className="-my-0.5">
          {m.cycleNotOpen}
        </Badge>
      )}
    </div>
  );
}
