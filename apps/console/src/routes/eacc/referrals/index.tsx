import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { CursorPager } from '../../../components/cursor-pager';
import { Page, PageHead } from '../../../components/page';
import {
  nextPage,
  type PageLocation,
  type PagingState,
  pagingFor,
  pagingView,
  previousPage,
} from '../../../components/paging';
import { messages as t } from '../../../components/referral-intake/messages';
import { ReferralIntakeView } from '../../../components/referral-intake/referral-intake-view';
import { ICMS_STATUSES } from '../../../components/referral-intake/statuses';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getReferralIntake } from '../../../server/referral-intake';
import type { ReferralIntakePage } from '../../../server/reporting/types';
import type { ServiceResult } from '../../../server/service-call';

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** The Referrals received list's way back through its pages (`components/paging.ts`). */
    referralIntakePaging?: PagingState;
  }
}

const searchSchema = z.object({
  icmsStatus: z.enum(ICMS_STATUSES).optional(),
  cursor: z.string().min(1).max(200).optional(),
});
type IntakeSearch = z.infer<typeof searchSchema>;

/**
 * EACC's referrals received (spec 09 FE-5; S12): the ICMS status filter and the page in the URL
 * (`icmsStatus`, `cursor`), the way back in history state.
 */
export const Route = createFileRoute('/eacc/referrals/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({
    context,
    deps,
    location,
  }): Promise<ServiceResult<ReferralIntakePage> | null> => {
    if (!context.workspace) return null;
    const result = await getReferralIntake({ data: deps });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${t.title} · Adili Online Console` }] }),
  pendingComponent: () => <IntakeRoutePage result={null} />,
  component: IntakeLoaded,
});

function IntakeLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <IntakeRoutePage result={result} />;
}

function IntakeRoutePage({ result }: { result: ServiceResult<ReferralIntakePage> | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/eacc/referrals/' });
  const state = useLocation({ select: (location) => location.state.referralIntakePaging });
  const paging = pagingFor(search.cursor, state);
  const page = result?.ok ? result.data : null;
  const view = page ? pagingView(page, paging) : null;
  const next = page ? nextPage(search, page, paging) : null;
  const go = ({ search: to, state: nextState }: PageLocation<IntakeSearch>) => {
    void navigate({ search: to, state: { referralIntakePaging: nextState } });
  };
  return (
    <Page>
      <PageHead title={t.title} />
      <ReferralIntakeView
        result={result}
        filter={search.icmsStatus ?? 'all'}
        firstPage={!search.cursor}
        onFilterChange={(filter) => {
          void navigate({ search: { icmsStatus: filter === 'all' ? undefined : filter } });
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
