import { Button } from '@adili/ui';
import { createFileRoute, Link, useRouter, useRouterState } from '@tanstack/react-router';

import { IntegrationsView } from '../../components/integrations/integrations-view';
import { messages as m } from '../../components/integrations/messages';
import { signInRedirect } from '../../components/sign-in-redirect';
import type {
  IntegrationGatewayResult,
  SystemCoverage,
} from '../../server/integration-gateway/client';
import {
  getIntegrationsCoverage,
  pauseIntegration,
  resumeIntegration,
} from '../../server/integrations';

/** The coverage and when it was read. */
interface IntegrationsData {
  coverage: IntegrationGatewayResult<SystemCoverage[]>;
  loadedAt: string;
}

/** Platform settings: how each registry integration behaves (spec 07b FE-3). Platform admins. */
export const Route = createFileRoute('/platform/integrations')({
  loader: async ({ context, location }): Promise<IntegrationsData | null> => {
    // The layout shows why there is no workspace; do not fetch coverage.
    if (!context.workspace) return null;
    const coverage = await getIntegrationsCoverage();
    if (!coverage.ok && coverage.error.kind === 'unauthenticated') {
      throw signInRedirect(location.href);
    }
    return { coverage, loadedAt: new Date().toISOString() };
  },
  staticData: { crumb: m.title },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: IntegrationsLoading,
  component: IntegrationsPage,
});

function IntegrationsLoading() {
  return <Integrations loaded={null} />;
}

function IntegrationsPage() {
  const loaded = Route.useLoaderData();
  return <Integrations loaded={loaded} />;
}

function Integrations({ loaded }: { loaded: IntegrationsData | null }) {
  const router = useRouter();
  const refreshing = useRouterState({ select: (state) => state.isLoading });
  return (
    <IntegrationsView
      result={loaded?.coverage ?? null}
      loadedAt={loaded?.loadedAt ?? null}
      refreshing={refreshing}
      onRefresh={() => void router.invalidate()}
      forbiddenAction={
        <Button asChild variant="secondary" size="sm">
          <Link to="/">{m.backToOverview}</Link>
        </Button>
      }
      setPaused={(system, paused) =>
        (paused ? pauseIntegration : resumeIntegration)({ data: { system } })
      }
      onChanged={() => void router.invalidate()}
    />
  );
}
