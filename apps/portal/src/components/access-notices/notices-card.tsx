import { Alert, AlertDescription, Button, Card, CardTitle, Icon } from '@adili/ui';
import { AlertCircleIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { Suspense, use } from 'react';

import { NOTICES_COPY as COPY } from '../../access/notice-copy';
import { needsResponse, sortNotices } from '../../access/notices';
import type { NoticesLoad } from '../../server/access-notices';
import { NoticeRow } from './notice-parts';

/** How many requests the Home card shows; the rest are on Access requests. */
export const CARD_ROWS = 2;

/**
 * The Access requests card on Home (spec 10 FE-4). It shows only when someone has requested
 * access to the declarant's declaration: at the top of the page while one waits for their
 * response (`placement="first"`), else under the obligations (`placement="last"`). Both slots
 * read the same streamed list and at most one renders; neither shows while it loads.
 */
export function AccessNoticesSection({
  notices,
  placement,
}: {
  notices: Promise<NoticesLoad>;
  placement: 'first' | 'last';
}) {
  return (
    <Suspense fallback={null}>
      <ResolvedNotices promise={notices} placement={placement} />
    </Suspense>
  );
}

function ResolvedNotices({
  promise,
  placement,
}: {
  promise: Promise<NoticesLoad>;
  placement: 'first' | 'last';
}) {
  const load = use(promise);
  if (load.status === 'unavailable') {
    return placement === 'last' ? <AccessNoticesCard load={load} /> : null;
  }
  if (load.status !== 'ok' || load.notices.length === 0) return null;
  const waiting = load.notices.some((notice) => needsResponse(notice, load.now));
  return waiting === (placement === 'first') ? <AccessNoticesCard load={load} /> : null;
}

/** The card: the requests that matter most first, two of them, and View all. */
export function AccessNoticesCard({ load }: { load: NoticesLoad }) {
  const rows = load.status === 'ok' ? sortNotices(load.notices, load.now).slice(0, CARD_ROWS) : [];
  return (
    <Card asChild className="gap-0 overflow-hidden p-0 sm:p-0">
      <section aria-labelledby="access-notices-card">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3.5 sm:px-6">
          <CardTitle id="access-notices-card" className="flex-1">
            {COPY.card}
          </CardTitle>
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <Link to="/access/notices" search={{}}>
              {COPY.viewAll}
              <Icon icon={ArrowRight01Icon} />
            </Link>
          </Button>
        </div>
        {load.status === 'ok' ? (
          <ul aria-label={COPY.card}>
            {rows.map((notice) => (
              <NoticeRow key={notice.requestId} notice={notice} now={load.now} />
            ))}
          </ul>
        ) : (
          <div className="p-5 sm:px-6">
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertDescription>
                {COPY.unavailableTitle}. {COPY.unavailableText}
              </AlertDescription>
            </Alert>
          </div>
        )}
      </section>
    </Card>
  );
}
