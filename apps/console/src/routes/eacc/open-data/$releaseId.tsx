import { EACC_SUPERVISOR } from '@adili/roles';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../../components/open-data/messages';
import { ReleaseActions } from '../../../components/open-data/release-actions';
import { releaseName } from '../../../components/open-data/release-parts';
import { ReleaseView } from '../../../components/open-data/release-view';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import {
  buildOpenDataReleaseFn,
  getOpenDataReleasePage,
  publishOpenDataReleaseFn,
  type ReleasePage,
  withdrawOpenDataReleaseFn,
} from '../../../server/open-data-releases';

/**
 * One open-data release: a preview with its six tables, or a published or withdrawn one (#350),
 * with Publish and Withdraw for EACC supervisors and its version history (#353).
 */
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
  const { roles } = Route.useRouteContext();
  const navigate = useNavigate();
  if (!page) return null;
  // The service decides (403 for anyone else); the console only hides what they cannot do.
  const supervisor = roles.includes(EACC_SUPERVISOR);
  return (
    <ReleaseView
      result={page.release}
      links={page.links}
      supervisor={supervisor}
      actions={(view) => (
        <ReleaseActions
          view={view}
          supervisor={supervisor}
          publish={(releaseId, idempotencyKey) =>
            publishOpenDataReleaseFn({ data: { releaseId, idempotencyKey } })
          }
          withdraw={(releaseId, reason, idempotencyKey) =>
            withdrawOpenDataReleaseFn({ data: { releaseId, reason, idempotencyKey } })
          }
          rebuild={(fy, kind, idempotencyKey) =>
            buildOpenDataReleaseFn({ data: { fy, kind, idempotencyKey } })
          }
          onRebuilt={(release) => {
            void navigate({ to: '/eacc/open-data/$releaseId', params: { releaseId: release.id } });
          }}
          onUnauthenticated={() => {
            goToSignIn();
          }}
        />
      )}
    />
  );
}
