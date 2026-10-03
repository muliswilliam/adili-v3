import { Card, Skeleton, StatTileSkeleton } from '@adili/ui';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';

import { OpenDataShell } from '../../components/open-data/open-data-shell';
import { OpenDataView } from '../../components/open-data/open-data-view';
import { pageCopy } from '../../open-data/copy';
import { getOpenDataPage } from '../../server/open-data';

const search = z.object({
  fy: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
  kind: z.enum(['annual', 'snapshot']).optional().catch(undefined),
  version: z.coerce.number().int().min(1).optional().catch(undefined),
  lang: z.enum(['sw']).optional().catch(undefined),
});

/**
 * The public Open data page (spec 09b FE-4, S11), no sign-in: `?fy=2025&kind=annual&version=1`
 * picks a release (the latest year's current annual release by default), `?lang=sw` reads it in
 * Swahili.
 */
export const Route = createFileRoute('/open-data/')({
  validateSearch: search,
  loaderDeps: ({ search: { fy, kind, version } }) => ({ fy, kind, version }),
  loader: ({ deps }) => getOpenDataPage({ data: deps }),
  head: ({ match }) => ({
    meta: [{ title: pageCopy(match.search.lang ?? 'en').metaTitle }],
  }),
  pendingComponent: OpenDataPending,
  component: OpenDataRoute,
});

function OpenDataRoute() {
  const page = Route.useLoaderData();
  const { lang } = Route.useSearch();
  const router = useRouter();
  const language = lang ?? 'en';
  return (
    <OpenDataShell current="open-data" language={language}>
      <OpenDataView
        page={page}
        language={language}
        onRetry={() => {
          void router.invalidate();
        }}
      />
    </OpenDataShell>
  );
}

function OpenDataPending() {
  const { lang } = Route.useSearch();
  const language = lang ?? 'en';
  return (
    <OpenDataShell current="open-data" language={language}>
      <h1 className="mb-6 text-[28px] leading-tight font-semibold tracking-[-0.02em]">
        {pageCopy(language).title}
      </h1>
      <div aria-busy="true" aria-label={pageCopy(language).loading} className="grid gap-5">
        <Card className="flex-row items-end gap-4 p-4 sm:p-4">
          <Skeleton className="h-11 w-72" />
          <Skeleton className="h-5 w-48" />
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((tile) => (
            <StatTileSkeleton key={tile} lines={1} />
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Card className="h-80">
            <Skeleton className="h-5 w-40" />
          </Card>
          <Card className="h-80">
            <Skeleton className="h-5 w-32" />
          </Card>
        </div>
      </div>
    </OpenDataShell>
  );
}
