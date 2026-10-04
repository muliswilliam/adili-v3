import { SiteFooter, SiteHeader, ToastProvider, TooltipProvider, useToast } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { DISCARD_AMENDMENT_COPY } from '../../components/declaration/discard-amendment-dialog';
import { settleLoad } from '../../components/declaration/route-helpers';
import { MyDeclarationsView } from '../../components/my-declarations/my-declarations-view';
import { DeclarantHeaderActions } from '../../components/help/parts';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '../../declaration/my-declarations';
import { getMyDeclarationsPage } from '../../server/my-declarations';

/**
 * "My declarations" (spec 06 FE-4): every declaration of the declarant, a page at a time
 * (`?page=2&size=10`), with versions, slips and amending.
 */
export const Route = createFileRoute('/declarations/')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
    size: z.coerce.number().pipe(z.literal(PAGE_SIZES)).optional().catch(undefined),
    /** Set by the workspace after discarding an amendment of this version: confirms it. */
    discarded: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, size: search.size ?? DEFAULT_PAGE_SIZE }),
  loader: async ({ deps, location }) =>
    settleLoad(
      await getMyDeclarationsPage({
        data: { page: deps.page, pageSize: deps.size },
      }),
      location.href,
    ),
  head: () => ({ meta: [{ title: 'My declarations · Adili Online' }] }),
  component: MyDeclarationsRoute,
});

/** Confirms an amendment discarded in the workspace, which sends the declarant here. */
function DiscardedToast({ version }: { version: number }) {
  const { toast } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ title: DISCARD_AMENDMENT_COPY.discarded(version) });
    void navigate({ search: (search) => ({ ...search, discarded: undefined }), replace: true });
  }, [toast, navigate, version]);
  return null;
}

function MyDeclarationsRoute() {
  const result = Route.useLoaderData();
  const { discarded } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <ToastProvider>
      {discarded ? <DiscardedToast version={discarded} /> : null}
      <TooltipProvider>
        <SiteHeader actions={<DeclarantHeaderActions />} />
        <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pt-6 pb-12 sm:px-7 sm:pt-9 sm:pb-16">
          <MyDeclarationsView
            result={result}
            onPage={(page) => {
              void navigate({ search: (search) => ({ ...search, page }) });
              window.scrollTo(0, 0);
            }}
            onPageSize={(size) => {
              void navigate({ search: { size } });
            }}
          />
        </main>
        <SiteFooter />
      </TooltipProvider>
    </ToastProvider>
  );
}
