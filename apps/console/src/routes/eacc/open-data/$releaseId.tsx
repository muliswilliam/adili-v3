import { createFileRoute } from '@tanstack/react-router';

import { messages as m } from '../../../components/open-data/messages';
import { releaseName } from '../../../components/open-data/release-parts';
import { ReleaseView } from '../../../components/open-data/release-view';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getOpenDataReleasePage, type ReleasePage } from '../../../server/open-data-releases';

/** One open-data release: a preview with its six tables, or a published or withdrawn one (#350). */
export const Route = createFileRoute('/eacc/open-data/$releaseId')({
  loader: async ({ context, params, location }) => {
    if (!context.workspace) return null;
    const page = await getOpenDataReleasePage({ data: { releaseId: params.releaseId } });
    if (!page.release.ok && page.release.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return page;
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${titleOf(loaderData)} · Adili Online Console` }],
  }),
  staticData: {
    crumb: ({ loaderData }) => titleOf(loaderData as ReleasePage | null | undefined),
  },
  pendingComponent: () => (
    <ReleaseView result={null} links={{ publicPage: null, verifyBase: null }} />
  ),
  component: ReleasePageView,
});

function titleOf(page: ReleasePage | null | undefined): string {
  return page?.release.ok ? releaseName(page.release.data.release) : m.release;
}

function ReleasePageView() {
  const page = Route.useLoaderData();
  if (!page) return null;
  return <ReleaseView result={page.release} links={page.links} />;
}
