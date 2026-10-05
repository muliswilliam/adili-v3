import { createFileRoute } from '@tanstack/react-router';

import { AuditChainsView } from '../../components/audit/audit-chains-view';
import { AuditTabs } from '../../components/audit/audit-tabs';
import { messages as t } from '../../components/audit/messages';
import { Page, PageHead } from '../../components/page';
import { signInRedirect } from '../../components/sign-in-redirect';
import type { AuditChainPage } from '../../server/audit/types';
import { getAuditChains } from '../../server/audit-trail';
import type { ServiceResult } from '../../server/service-call';

/** The integrity of the audit trail (ADR-008): its chains per tenant per day, anchored and verifiable. */
export const Route = createFileRoute('/audit/integrity')({
  loader: async ({ context, location }): Promise<ServiceResult<AuditChainPage> | null> => {
    if (!context.workspace) return null;
    const result = await getAuditChains({ data: {} });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  staticData: { crumb: t.integrityTab },
  head: () => ({ meta: [{ title: `${t.integrityTab} · ${t.title} · Adili Online Console` }] }),
  pendingComponent: () => <IntegrityPage result={null} />,
  component: IntegrityLoaded,
});

function IntegrityLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <IntegrityPage result={result} />;
}

function IntegrityPage({ result }: { result: ServiceResult<AuditChainPage> | null }) {
  return (
    <Page>
      <PageHead title={t.title}>
        <p className="mt-1.5 max-w-[760px] text-[14px] text-muted-foreground">{t.intro}</p>
      </PageHead>
      <AuditTabs current="integrity" />
      <AuditChainsView result={result} />
    </Page>
  );
}
