import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  FilterChip,
  formatDate,
  Icon,
  RegisterList,
} from '@adili/ui';
import { FilterIcon, Notification03Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { HISTORY_COPY as COPY } from '../../access/history-copy';
import {
  countByFilter,
  filterEntries,
  HISTORY_FILTERS,
  HISTORY_PAGE_SIZE,
  type HistoryFilter,
  pageOfEntries,
  toRegisterEntry,
  visibleEntries,
} from '../../access/history';
import { needsResponse, sortNotices } from '../../access/notices';
import type {
  AccessHistoryEntry,
  DeclarantNotice,
  FormKDeclarantNotice,
} from '../../server/access/types';
import { Pager } from '../access/requests-list';
import { UnavailableAlert } from '../access-notices/notices-shell';
import { useCertifiedCopies } from '../certified-copies/use-certified-copies';
import { HistoryDrawer } from './history-drawer';
import { FootNote } from './transparency-frame';

const FILTER_LABELS: Record<HistoryFilter, string> = {
  all: COPY.all,
  'form-k': COPY.formK,
  lea: COPY.lea,
  copy: COPY.copies,
};

/**
 * Who accessed my declaration (spec 10 FE-4, S12): the register entries about the declarant,
 * newest first and grouped by month, ten to a page, narrowed by what they are about. Each opens
 * a drawer with the request or the certified copy. A request waiting for the declarant's
 * response is called out on top.
 */
export function HistoryView({
  entries,
  notices,
  now,
  filter,
  page,
  onFilter,
  onPage,
}: {
  entries: AccessHistoryEntry[];
  /** The requests the entries are about; empty when they could not be loaded. */
  notices: DeclarantNotice[];
  /** The server's clock at load. */
  now: string;
  filter: HistoryFilter;
  page: number;
  onFilter: (filter: HistoryFilter) => void;
  onPage: (page: number) => void;
}) {
  const all = useMemo(() => visibleEntries(entries), [entries]);
  const [openId, setOpenId] = useState<string | null>(null);
  const copies = useCertifiedCopies();
  if (all.length === 0) {
    return (
      <Card className="p-0 sm:p-0">
        <EmptyState
          className="py-14"
          icon={<Icon icon={ViewIcon} />}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
        />
      </Card>
    );
  }
  const counts = countByFilter(all);
  const list = filterEntries(all, filter);
  const shown = pageOfEntries(list, page);
  const waiting = sortNotices(notices, now).find(
    (notice): notice is FormKDeclarantNotice =>
      notice.kind === 'form-k' && needsResponse(notice, now),
  );
  const open = all.find((entry) => entry.id === openId) ?? null;
  return (
    <div className="grid gap-4">
      {waiting ? <WaitingCallout notice={waiting} /> : null}
      <div role="group" aria-label={COPY.filters} className="flex flex-wrap gap-2">
        {HISTORY_FILTERS.map((each) => (
          <FilterChip
            key={each}
            pressed={filter === each}
            onPressedChange={() => {
              onFilter(each);
            }}
            count={counts[each]}
            countLabel={COPY.entries}
          >
            {FILTER_LABELS[each]}
          </FilterChip>
        ))}
      </div>
      <Card className="gap-0 overflow-hidden p-0 sm:p-0">
        {shown.entries.length > 0 ? (
          <RegisterList
            label={COPY.listLabel}
            headingLevel={2}
            entries={shown.entries.map((entry) => toRegisterEntry(entry, all, notices))}
            onSelect={(entry) => {
              setOpenId(entry.id);
            }}
          />
        ) : (
          <EmptyState
            className="py-12"
            icon={<Icon icon={FilterIcon} />}
            title={COPY.filterEmptyTitle}
            description={COPY.filterEmptyText}
            action={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  onFilter('all');
                }}
              >
                {COPY.showAll}
              </Button>
            }
          />
        )}
        <Pager
          page={shown.page}
          total={list.length}
          pageSize={HISTORY_PAGE_SIZE}
          label={COPY.pagination}
          onPage={onPage}
        />
      </Card>
      <FootNote text={COPY.footNote} tip={COPY.whatShowsText} tipLabel={COPY.whatShows} />
      <HistoryDrawer
        entry={open}
        all={all}
        notices={notices}
        now={now}
        copies={copies}
        onClose={() => {
          setOpenId(null);
        }}
      />
    </div>
  );
}

/** "Wanjiru Kamau asked to see your declaration. Respond by 29 Sep 2026." with Respond. */
function WaitingCallout({ notice }: { notice: FormKDeclarantNotice }) {
  return (
    <Alert
      variant="warning"
      role="note"
      className="sm:py-2.5 sm:pr-2.5 sm:[&>svg]:top-1/2 sm:[&>svg]:-translate-y-1/2"
    >
      <Icon icon={Notification03Icon} />
      <AlertDescription className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <p className="min-w-[220px] flex-1">
          {COPY.waiting(notice.applicantName, formatDate(notice.windowEndsAt ?? notice.notifiedAt))}
        </p>
        <Button asChild variant="secondary" size="sm">
          <Link to="/access/notices/$id" params={{ id: notice.requestId }}>
            {COPY.respond}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The history could not be loaded: say so, with Try again. */
export function HistoryUnavailable() {
  return <UnavailableAlert title={COPY.unavailableTitle} text={COPY.unavailableText} />;
}
