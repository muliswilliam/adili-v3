import { SiteFooter, SiteHeader } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';

import { settleLoad } from '../../components/declaration/route-helpers';
import { NoticesSkeleton, NoticesView } from '../../components/notices/notices-view';
import { SignOutButton } from '../../components/sign-out-button';
import { getMyNotices } from '../../server/notices';

/**
 * The declarant's notices to comply and warnings (spec 08 FE-7, S17). The contract returns the
 * whole list, so it pages in the browser (`?page=2`) without asking again.
 */
export const Route = createFileRoute('/notices/')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => settleLoad(await getMyNotices(), location.href),
  head: () => ({ meta: [{ title: 'Notices · Adili Online' }] }),
  pendingComponent: () => (
    <Page>
      <NoticesSkeleton />
    </Page>
  ),
  component: NoticesRoute,
});

function Page({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader actions={<SignOutButton />} />
      <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pt-6 pb-12 sm:px-7 sm:pt-9 sm:pb-16">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}

function NoticesRoute() {
  const load = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  return (
    <Page>
      <NoticesView
        result={load}
        now={load.now}
        page={page ?? 1}
        onPage={(next) => {
          void navigate({ search: { page: next }, resetScroll: false });
        }}
        onRetry={() => void router.invalidate()}
      />
    </Page>
  );
}
