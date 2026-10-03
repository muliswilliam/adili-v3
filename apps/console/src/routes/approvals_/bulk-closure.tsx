import { useToday } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { closureFilter, closureSearchSchema } from '../../closures/search';
import { BulkClosureView } from '../../components/closures/bulk-closure-view';
import { en as m } from '../../components/closures/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import { WorkspaceLayout } from '../../components/workspace-layout';
import { workspaceFor } from '../../components/workspaces';
import { cycleOptions } from '../../review-queue/query';
import { approveBulkClosures, type ClosureSummary, getClosureSummary } from '../../server/closures';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';
import { getViewer } from '../../server/viewer';

/**
 * Bulk closure (spec 08 FE-4): the Commission's supervisors approve the system's "no issues
 * identified" proposals of a cycle in batches. Its own route, outside the Approvals inbox's
 * layout (#199), in the Approvals workspace; reviewers are told it is for supervisors.
 */
export const Route = createFileRoute('/approvals_/bulk-closure')({
  validateSearch: closureSearchSchema(() => Date.now()),
  beforeLoad: async ({ location }) => {
    const viewer = await getViewer();
    if (!viewer) throw signInRedirect(location.href);
    const roles = viewer.directory.ok ? viewer.directory.principal.roles : [];
    const slug = viewer.directory.ok ? viewer.directory.principal.tenant : null;
    return { viewer, roles, slug, workspace: workspaceFor(roles, 'approvals') ?? null };
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, location }): Promise<ServiceResult<ClosureSummary> | null> => {
    // The layout shows why there is no workspace; do not fetch the counts.
    if (!context.workspace) return null;
    if (!context.slug) return SERVICE_UNAVAILABLE;
    const summary = await getClosureSummary({
      data: { slug: context.slug, filter: closureFilter(deps) },
    });
    if (!summary.ok && summary.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return summary;
  },
  staticData: { crumb: m.title },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: BulkClosureLoading,
  component: BulkClosureLoaded,
});

function BulkClosureLoading() {
  return <BulkClosure summary={null} />;
}

function BulkClosureLoaded() {
  return <BulkClosure summary={Route.useLoaderData()} />;
}

function BulkClosure({ summary }: { summary: ServiceResult<ClosureSummary> | null }) {
  const { viewer, roles, workspace, slug } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/approvals/bulk-closure' });
  const filter = closureFilter(search);
  const today = useToday();
  return (
    <WorkspaceLayout
      viewer={viewer}
      roles={roles}
      workspace={workspace}
      title={m.title}
      forbidden={m.supervisorsOnly}
    >
      <BulkClosureView
        summary={summary}
        search={search}
        onSearchChange={(next) => {
          void navigate({ search: next, resetScroll: false });
        }}
        cycles={cycleOptions(today, search.cycle)}
        approve={(idempotencyKey) =>
          slug
            ? approveBulkClosures({ data: { slug, filter, idempotencyKey } })
            : Promise.resolve(SERVICE_UNAVAILABLE)
        }
        readSummary={() =>
          slug
            ? getClosureSummary({ data: { slug, filter } })
            : Promise.resolve(SERVICE_UNAVAILABLE)
        }
      />
    </WorkspaceLayout>
  );
}
