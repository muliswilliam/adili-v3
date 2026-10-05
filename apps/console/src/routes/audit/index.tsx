import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { AuditEventsView } from '../../components/audit/audit-events-view';
import { AuditTabs } from '../../components/audit/audit-tabs';
import { messages as t } from '../../components/audit/messages';
import { CursorPager } from '../../components/cursor-pager';
import { Page, PageHead } from '../../components/page';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../components/paging';
import { signInRedirect } from '../../components/sign-in-redirect';
import { AUDIT_KINDS, type AuditEventPage } from '../../server/audit/types';
import { getAuditEvents } from '../../server/audit-trail';
import type { ServiceResult } from '../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The audit events list's way back through its pages (`components/paging.ts`). */
    auditPaging?: PagingState;
  }
}

const searchSchema = z.object({
  kind: z.enum(AUDIT_KINDS).optional(),
  tenant: z
    .string()
    .regex(/^[a-z][a-z0-9]{1,19}$/)
    .optional(),
  actor: z.string().min(1).max(200).optional(),
  subjectPersonId: z.uuid().optional(),
  action: z.string().min(1).max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  cursor: z.string().min(1).max(500).optional(),
});
type AuditSearch = z.infer<typeof searchSchema>;

/** The audit trail's events (ADR-008): the filters and the page in the URL, the way back in history state. */
export const Route = createFileRoute('/audit/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, location }): Promise<ServiceResult<AuditEventPage> | null> => {
    if (!context.workspace) return null;
    const result = await getAuditEvents({ data: deps });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${t.title} · Adili Online Console` }] }),
  pendingComponent: () => <AuditEventsPage result={null} />,
  component: AuditEventsLoaded,
});

function AuditEventsLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <AuditEventsPage result={result} />;
}

/** The filters of the URL, without the page. */
function filtersOf({ kind, tenant, actor, subjectPersonId, action, from, to }: AuditSearch) {
  return { kind, tenant, actor, subjectPersonId, action, from, to };
}

function AuditEventsPage({ result }: { result: ServiceResult<AuditEventPage> | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/audit/' });
  const state = useLocation({ select: (location) => location.state.auditPaging });
  const paging = pagingFor(search.cursor, state);
  const page = result?.ok ? result.data : null;
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(search, page, paging) : null;
  const go = ({ search: to, state: nextState }: PageLocation<AuditSearch>) => {
    void navigate({ search: to, state: { auditPaging: nextState } });
  };
  const filters = filtersOf(search);
  return (
    <Page>
      <PageHead title={t.title}>
        <p className="mt-1.5 max-w-[760px] text-[14px] text-muted-foreground">{t.intro}</p>
      </PageHead>
      <AuditTabs current="events" />
      <AuditEventsView
        result={result}
        filters={filters}
        firstPage={!search.cursor}
        onFiltersChange={(changed) => {
          void navigate({ search: changed });
        }}
        pager={
          view && page && (view.hasPrevious || next) ? (
            <CursorPager
              labels={t.list.pager}
              range={view.range}
              rows={page.items.length}
              hasPrevious={view.hasPrevious}
              hasNext={next !== null}
              onPrevious={() => {
                go(previousPage(search, paging));
              }}
              onNext={() => {
                if (next) go(next);
              }}
            />
          ) : null
        }
      />
    </Page>
  );
}
