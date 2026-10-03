import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { financialYearAt } from '../../../components/national-report/model';
import { messages as m } from '../../../components/open-data/messages';
import { ReleasesView } from '../../../components/open-data/releases-view';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import {
  buildOpenDataSnapshotFn,
  getOpenDataReleasesPage,
  type ReleasesPage,
} from '../../../server/open-data-releases';

/** EACC's open-data releases and Build snapshot (spec 09b FE-3, #350). */
export const Route = createFileRoute('/eacc/open-data/')({
  loader: async ({ context, location }) => {
    // The layout shows why there is no workspace; do not fetch the releases.
    if (!context.workspace) return null;
    const page = await getOpenDataReleasesPage();
    if (!page.releases.ok && page.releases.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return page;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: () => <ReleasesPageView page={null} />,
  component: ReleasesLoaded,
});

function ReleasesLoaded() {
  const page = Route.useLoaderData();
  if (!page) return null;
  return <ReleasesPageView page={page} />;
}

function ReleasesPageView({ page }: { page: ReleasesPage | null }) {
  const navigate = useNavigate();
  return (
    <ReleasesView
      result={page?.releases ?? null}
      links={page?.links ?? { publicPage: null, verifyBase: null }}
      fy={financialYearAt(new Date())}
      build={(fy, idempotencyKey) => buildOpenDataSnapshotFn({ data: { fy, idempotencyKey } })}
      onBuilt={(release) => {
        void navigate({ to: '/eacc/open-data/$releaseId', params: { releaseId: release.id } });
      }}
      onUnauthenticated={() => {
        goToSignIn();
      }}
    />
  );
}
