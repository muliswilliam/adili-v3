import { Button, Card, CardTitle } from '@adili/ui';
import { Link } from '@tanstack/react-router';
import { Suspense, use } from 'react';

import { COPY } from '../../notices/copy';
import { followedBy, isClosed } from '../../notices/view';
import type { MyNoticesLoad } from '../../server/notices';
import type { DeclarantNotice } from '../../server/review/types';
import { NoticeRows } from '../notices/notices-view';

/**
 * The dashboard's "Notices" card (spec 08 FE-7): shown only while a notice or warning is open,
 * listing those, with View all. The route loader does not wait for the list: nothing shows until
 * it arrives, and nothing when it fails (the Notices page says so and offers a retry).
 */
export function NoticesSection({ notices }: { notices: Promise<MyNoticesLoad> }) {
  return (
    <Suspense fallback={null}>
      <ResolvedNoticesCard promise={notices} />
    </Suspense>
  );
}

/** The notices still running: open, and not replaced by a later step. */
export function openNotices(notices: readonly DeclarantNotice[]): DeclarantNotice[] {
  return notices.filter((notice) => !isClosed(notice) && followedBy(notice, notices) === null);
}

function ResolvedNoticesCard({ promise }: { promise: Promise<MyNoticesLoad> }) {
  const load = use(promise);
  if (load.status !== 'ok' || openNotices(load.notices).length === 0) return null;
  return <NoticesCard notices={load.notices} now={load.now} />;
}

export function NoticesCard({
  notices,
  now,
}: {
  notices: DeclarantNotice[];
  /** The server's clock when the list loaded. */
  now: string;
}) {
  return (
    <Card asChild className="overflow-hidden p-0 sm:p-0">
      <section aria-labelledby="dashboard-notices">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:px-6 sm:py-[18px]">
          <CardTitle id="dashboard-notices" className="flex-1">
            {COPY.title}
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/notices" aria-label={COPY.viewAllLabel}>
              {COPY.viewAll}
            </Link>
          </Button>
        </div>
        <NoticeRows notices={openNotices(notices)} all={notices} now={now} />
      </section>
    </Card>
  );
}
