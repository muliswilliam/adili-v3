import { SiteFooter, SiteHeader } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { z } from 'zod';

import {
  ClarificationsSkeleton,
  ClarificationsView,
} from '../../components/clarification/clarification-list';
import { settleLoad } from '../../components/declaration/route-helpers';
import { SignOutButton } from '../../components/sign-out-button';
import { getMyClarifications } from '../../server/clarifications';

/**
 * The declarant's clarifications (spec 07a FE-5): those that need a response, then the earlier
 * ones. The contract returns the whole list, so the earlier ones page in the browser
 * (`?page=2`) without asking again.
 */
export const Route = createFileRoute('/clarifications/')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => settleLoad(await getMyClarifications(), location.href),
  head: () => ({ meta: [{ title: 'Clarifications · Adili Online' }] }),
  pendingComponent: () => (
    <Page>
      <ClarificationsSkeleton />
    </Page>
  ),
  component: ClarificationsRoute,
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

function ClarificationsRoute() {
  const load = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const router = useRouter();
  return (
    <Page>
      <ClarificationsView
        result={load}
        now={load.now}
        page={page ?? 1}
        onPage={(next) => {
          // The view brings the earlier group into view; the page should not jump to the top.
          void navigate({ search: { page: next }, resetScroll: false });
        }}
        onRetry={() => void router.invalidate()}
      />
    </Page>
  );
}
