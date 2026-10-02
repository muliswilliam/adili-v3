import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { AiPolicyView } from '../../components/ai-policy/ai-policy-view';
import { messages as m } from '../../components/ai-policy/messages';
import { aiPolicySearch } from '../../components/ai-policy/model';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import type { AiPolicyOverview } from '../../server/ai-policy.server';
import { getAiPolicyOverview, setGatePolicy, setTenantBudget } from '../../server/ai-policy';
import type { ServiceResult } from '../../server/service-call';
import { BackToOverview } from './route';

export const Route = createFileRoute('/ai-policy/')({
  // Tab, search, filter and page are applied in the browser: the policy is read once per visit.
  validateSearch: aiPolicySearch,
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ context, location }) => {
    // The layout shows why there is no workspace; do not fetch the policy.
    if (!context.workspace) return null;
    const result = await getAiPolicyOverview();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: AiPolicyLoading,
  component: AiPolicyLoaded,
});

function AiPolicyLoading() {
  return <AiPolicyPage result={null} />;
}

function AiPolicyLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <AiPolicyPage result={result} />;
}

function AiPolicyPage({ result }: { result: ServiceResult<AiPolicyOverview> | null }) {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/ai-policy/' });
  return (
    <AiPolicyView
      result={result}
      search={search}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
      saveGate={(data) => setGatePolicy({ data })}
      saveBudget={(data) => setTenantBudget({ data })}
      onUnauthenticated={() => {
        goToSignIn('/ai-policy');
      }}
      forbiddenAction={<BackToOverview />}
    />
  );
}
