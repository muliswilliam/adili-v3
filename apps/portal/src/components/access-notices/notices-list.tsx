import { Card, EmptyState, Icon } from '@adili/ui';
import { SquareLock02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

import { NOTICES_COPY as COPY } from '../../access/notice-copy';
import { sortNotices, windowOpen } from '../../access/notices';
import type { DeclarantNotice } from '../../server/access/types';
import { Pager, REQUESTS_PAGE_SIZE } from '../access/requests-list';
import { NoticeRow } from './notice-parts';

function Group({
  title,
  notices,
  now,
  footer = null,
}: {
  title: string;
  notices: DeclarantNotice[];
  now: string;
  footer?: ReactNode;
}) {
  if (notices.length === 0) return null;
  return (
    <section className="grid gap-2.5">
      <h2 className="text-[13px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
        {title}
      </h2>
      <Card className="gap-0 overflow-hidden p-0 sm:p-0">
        <ul aria-label={title}>
          {notices.map((notice) => (
            <NoticeRow key={notice.requestId} notice={notice} now={now} />
          ))}
        </ul>
        {footer}
      </Card>
    </section>
  );
}

/**
 * Access requests (spec 10 FE-4): the requests someone made to see the declarant's declaration.
 * Those whose window is open come first, under Open; the rest under Earlier, latest notified
 * first, ten to a page.
 */
export function NoticesList({
  notices,
  page,
  now,
  onPage,
}: {
  notices: DeclarantNotice[];
  page: number;
  /** The server's clock at load. */
  now: string;
  onPage: (page: number) => void;
}) {
  if (notices.length === 0) {
    return (
      <Card>
        <EmptyState
          className="py-14"
          icon={<Icon icon={SquareLock02Icon} />}
          title={COPY.emptyTitle}
          description={COPY.emptyText}
        />
      </Card>
    );
  }
  const sorted = sortNotices(notices, now);
  const open = sorted.filter((notice) => windowOpen(notice, now));
  const rest = sorted.filter((notice) => !windowOpen(notice, now));
  const pages = Math.max(1, Math.ceil(rest.length / REQUESTS_PAGE_SIZE));
  const shown = Math.min(Math.max(1, page), pages);
  return (
    <div className="grid gap-7">
      <Group title={COPY.open} notices={open} now={now} />
      <Group
        title={open.length > 0 ? COPY.earlier : COPY.all}
        notices={rest.slice((shown - 1) * REQUESTS_PAGE_SIZE, shown * REQUESTS_PAGE_SIZE)}
        now={now}
        footer={<Pager page={shown} total={rest.length} onPage={onPage} />}
      />
    </div>
  );
}
