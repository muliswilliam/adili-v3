import { Card, Skeleton } from '@adili/ui';
import { createFileRoute } from '@tanstack/react-router';

import { LoadError, NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { messages as m } from '../../components/policy/messages';
import { PolicyCard } from '../../components/policy/policy-card';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import { opensOwnPolicy } from '../../components/workspaces';
import { type CommissionAiStatus, getCommissionAiStatus } from '../../server/ai-status';
import type { DirectoryResult, TenantPolicyHistory } from '../../server/directory/client';
import { createTenantPolicyVersion, getTenantPolicy } from '../../server/policy';
import { SERVICE_UNAVAILABLE, type ServiceResult } from '../../server/service-call';

/** Staff of the Commission other than its admin: they do not see the policy (spec 04). */
const notAdmin = 'not-admin' as const;

interface PolicyLoad {
  policy: DirectoryResult<TenantPolicyHistory>;
  /** The Commission's AI status line (spec 07c FE-4). */
  aiStatus: ServiceResult<CommissionAiStatus>;
}

/**
 * The obligations policy of the viewer's own Commission (spec 04 FE-4): the policy card with the
 * start date change and the AI status line (spec 07c FE-4), in the Obligations workspace, for
 * commission admins only. The Commission's
 * other staff are told they have no access, and the policy is not fetched for them.
 */
export const Route = createFileRoute('/obligations/policy')({
  loader: async ({ context, location }): Promise<PolicyLoad | typeof notAdmin | null> => {
    // The layout shows no page without the workspace; do not fetch the policy.
    if (!context.workspace) return null;
    if (!opensOwnPolicy(context.roles)) return notAdmin;
    const slug = context.tenant;
    if (!slug) return { policy: SERVICE_UNAVAILABLE, aiStatus: SERVICE_UNAVAILABLE };
    const [policy, aiStatus] = await Promise.all([
      getTenantPolicy({ data: { slug } }),
      getCommissionAiStatus({ data: { slug } }),
    ]);
    if (!policy.ok && policy.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return { policy, aiStatus };
  },
  head: () => ({ meta: [{ title: `${m.pageTitle} · Adili Online Console` }] }),
  staticData: { crumb: m.crumb },
  pendingComponent: PolicyLoading,
  component: PolicyLoaded,
});

function PolicyLoading() {
  return <PolicyPage policy={null} />;
}

function PolicyLoaded() {
  const policy = Route.useLoaderData();
  if (!policy) return null;
  return <PolicyPage policy={policy} />;
}

function PolicyPage({ policy }: { policy: PolicyLoad | typeof notAdmin | null }) {
  const { tenant } = Route.useRouteContext();
  return (
    <Page narrow>
      <PageHead title={m.pageTitle} />
      <PolicyBody
        policy={policy}
        save={({ idempotencyKey, obligationsStartDate }) =>
          createTenantPolicyVersion({
            data: { slug: tenant ?? '', idempotencyKey, obligationsStartDate },
          })
        }
      />
    </Page>
  );
}

function PolicyBody({
  policy: load,
  save,
}: {
  policy: PolicyLoad | typeof notAdmin | null;
  save: Parameters<typeof PolicyCard>[0]['save'];
}) {
  if (load === null) return <PolicyCardSkeleton />;
  if (load === notAdmin) return <NoAccess text={m.noAccess} />;
  const { policy, aiStatus } = load;
  if (!policy.ok) {
    const { error } = policy;
    if (
      error.kind === 'problem' &&
      (error.problem.status === 403 || error.problem.status === 404)
    ) {
      return <NoAccess text={m.noAccess} />;
    }
    return (
      <LoadError
        title={m.loadErrorTitle}
        detail={(error.kind === 'unavailable' ? error.detail : null) ?? m.loadErrorDetail}
        retryLabel={m.tryAgain}
      />
    );
  }
  return (
    <PolicyCard
      history={policy.data}
      save={save}
      aiStatus={aiStatus}
      onUnauthenticated={() => {
        goToSignIn('/obligations/policy');
      }}
    />
  );
}

export function PolicyCardSkeleton() {
  return (
    <Card role="status" aria-busy="true" aria-label={m.cardTitle} className="gap-3.5">
      <Skeleton className="h-5 w-2/5" />
      {Array.from({ length: 5 }, (_, line) => (
        <Skeleton key={line} className={line % 2 ? 'w-3/5' : 'w-4/5'} />
      ))}
    </Card>
  );
}
