import { Button, Card, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';
import { z } from 'zod';

import type { DirectoryResult, RosterRecord } from '../../server/directory/client';
import { getRosterRecord } from '../../server/roster-records';
import { LoadError, NoAccess } from '../load-error';
import { Page } from '../page';
import { messages as m } from './messages';

const notFound: DirectoryResult<never> = {
  ok: false,
  error: { kind: 'problem', problem: { type: 'about:blank', title: 'Not Found', status: 404 } },
};

const unavailable: DirectoryResult<never> = {
  ok: false,
  error: { kind: 'unavailable', detail: null },
};

/**
 * Loads a record for a detail route. A link with an id that is not a record id reads as not
 * found, as the directory would answer; no Commission (a broken account) as a failed load.
 */
export function loadRosterRecord(
  slug: string | null,
  recordId: string,
): Promise<DirectoryResult<RosterRecord>> {
  if (!slug) return Promise.resolve(unavailable);
  if (!z.uuid().safeParse(recordId).success) return Promise.resolve(notFound);
  return getRosterRecord({ data: { slug, recordId } });
}

function statusOf(result: DirectoryResult<unknown>): number | null {
  return !result.ok && result.error.kind === 'problem' ? result.error.problem.status : null;
}

/** The breadcrumb for a record match, from loader data the router only knows as `unknown`. */
export function recordCrumb(loaderData: unknown): string | null {
  if (loaderData === undefined) return m.loading;
  if (loaderData === null || typeof loaderData !== 'object' || !('ok' in loaderData)) return null;
  const result = loaderData as DirectoryResult<RosterRecord>;
  if (result.ok) return result.data.fullName;
  const status = statusOf(result);
  if (status === 404) return m.recordNotFoundCrumb;
  if (status === 403) return m.record;
  return m.recordErrorTitle;
}

/** Why a record is not on show: not found (or another Commission's), refused, or failed. */
export function RecordLoadFailure({
  result,
  backLink,
  banner,
}: {
  result: DirectoryResult<unknown>;
  /** A router link back to the records list. */
  backLink: ReactNode;
  banner?: ReactNode;
}) {
  const status = statusOf(result);
  if (status === 403) {
    return (
      <Page narrow>
        {banner}
        <NoAccess
          text={m.recordsForbidden}
          action={<p className="text-sm">{m.recordsForbiddenText}</p>}
        />
      </Page>
    );
  }
  if (status === 404 || status === 400) {
    return (
      <Page narrow>
        {banner}
        <Card className="p-2 sm:p-2">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.recordNotFoundTitle}
            description={m.recordNotFoundText}
            action={
              <Button asChild variant="secondary" size="sm">
                {backLink}
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }
  const detail = !result.ok && result.error.kind === 'unavailable' ? result.error.detail : null;
  return (
    <Page narrow>
      {banner}
      <LoadError
        title={m.recordErrorTitle}
        detail={detail ?? m.errorDetail}
        retryLabel={m.tryAgain}
      />
    </Page>
  );
}
