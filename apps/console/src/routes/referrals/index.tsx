import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

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
import { messages as t } from '../../components/referrals/messages';
import { ReferralsList } from '../../components/referrals/referrals-list';
import { signInRedirect } from '../../components/sign-in-redirect';
import { REFERRAL_STATUSES } from '../../referral/view';
import type { ReferralsPage } from '../../server/referrals.server';
import { getReferrals } from '../../server/referrals';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The Referrals list's way back through its pages (`components/paging.ts`). */
    referralsPaging?: PagingState;
  }
}

const searchSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  cursor: z.string().max(500).optional(),
});
type ReferralsSearch = z.infer<typeof searchSchema>;

/**
 * The Commission's referrals to EACC (spec 08 FE-6): the status filter and the page in the URL
 * (`status`, `cursor`), the way back in history state.
 */
export const Route = createFileRoute('/referrals/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, location }): Promise<ServiceResult<ReferralsPage> | null> => {
    if (!context.workspace) return null;
    if (!context.tenant) return SERVICE_UNAVAILABLE;
    const result = await getReferrals({ data: { slug: context.tenant, ...deps } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${t.title} · Adili Online Console` }] }),
  pendingComponent: () => <ReferralsRoutePage result={null} />,
  component: ReferralsLoaded,
});

function ReferralsLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <ReferralsRoutePage result={result} />;
}

function ReferralsRoutePage({ result }: { result: ServiceResult<ReferralsPage> | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/referrals/' });
  const state = useLocation({ select: (location) => location.state.referralsPaging });
  const paging = pagingFor(search.cursor, state);
  const page = result?.ok ? result.data : null;
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(search, page, paging) : null;
  const go = ({ search: to, state: nextState }: PageLocation<ReferralsSearch>) => {
    void navigate({ search: to, state: { referralsPaging: nextState } });
  };
  return (
    <Page>
      <PageHead title={t.title} />
      <ReferralsList
        result={result}
        filter={search.status ?? 'all'}
        firstPage={!search.cursor}
        onFilterChange={(filter) => {
          void navigate({ search: { status: filter === 'all' ? undefined : filter } });
        }}
        referralLink={(referral, label) => (
          <Link
            to="/referrals/$referralId"
            params={{ referralId: referral.id }}
            className="hover:underline"
          >
            {label}
          </Link>
        )}
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
