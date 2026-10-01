import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { COPIES_COPY as COPY } from '../../access/history-copy';
import { TransparencyFrame } from '../../components/access-history/transparency-frame';
import { TransparencySkeleton } from '../../components/access-history/transparency-skeleton';
import { UnavailableAlert } from '../../components/access-notices/notices-shell';
import { CopiesView } from '../../components/certified-copies/copies-view';
import { signInRedirect } from '../../components/declaration/route-helpers';
import { getMyCertifiedCopiesPage } from '../../server/certified-copies';

/**
 * Certified copies (spec 10 FE-4, S13): a certified copy of any submitted version (`?page=2`).
 * The access service's certified-copy-ready SMS and email link here.
 */
export const Route = createFileRoute('/access/certified-copies')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => {
    const result = await getMyCertifiedCopiesPage();
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: 'Certified copies · Adili Online' }] }),
  pendingComponent: () => (
    <TransparencyFrame title={COPY.title} active="/access/certified-copies">
      <TransparencySkeleton />
    </TransparencyFrame>
  ),
  component: CertifiedCopiesRoute,
});

function CertifiedCopiesRoute() {
  const { versions, copies } = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <TransparencyFrame title={COPY.title} active="/access/certified-copies">
      {versions.status === 'ok' ? (
        <CopiesView
          versions={versions.versions}
          // Without the list the buttons still work: asking again returns the existing copy.
          copies={copies.status === 'ok' ? copies.copies : []}
          page={page ?? 1}
          onPage={(next) => {
            void navigate({ search: { page: next === 1 ? undefined : next } });
            window.scrollTo(0, 0);
          }}
        />
      ) : (
        <UnavailableAlert title={COPY.unavailableTitle} text={COPY.unavailableText} />
      )}
    </TransparencyFrame>
  );
}
