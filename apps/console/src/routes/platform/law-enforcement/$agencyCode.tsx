import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { AgencyOfficersPage } from '../../../components/platform/agency-officers';
import { messages as m } from '../../../components/platform/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getAgencyOfficers } from '../../../server/lea-accounts';

const AGENCY_CODE = /^[A-Z][A-Z0-9]{1,9}$/;

/** One agency's officer accounts: provision and revoke (spec 10 FE-6, S11). */
export const Route = createFileRoute('/platform/law-enforcement/$agencyCode')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) return null;
    if (!AGENCY_CODE.test(params.agencyCode)) throw notFound();
    const result = await getAgencyOfficers({ data: { code: params.agencyCode } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem' && result.error.problem.status === 404) {
      throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => codeCrumb(loaderData) },
  head: ({ params }) => ({
    meta: [{ title: `${params.agencyCode} · ${m.title} · Adili Online Console` }],
  }),
  component: AgencyRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={m.notFoundTitle}
        description={m.notFoundText}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/platform/law-enforcement">{m.backToAgencies}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

/** The crumb: the agency's code, once it is loaded. */
function codeCrumb(loaderData: unknown): string | null {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) return null;
  if (!loaderData.ok || !('data' in loaderData)) return m.title;
  const data = loaderData.data as { agency?: { code?: string } };
  return data.agency?.code ?? m.title;
}

function AgencyRoute() {
  const result = Route.useLoaderData();
  if (!result) return null;
  if (!result.ok) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <LoadError
          title={m.officersErrorTitle}
          detail={m.officersErrorDetail}
          retryLabel={m.tryAgain}
        />
      </Page>
    );
  }
  return <AgencyOfficersPage key={result.data.agency.code} data={result.data} />;
}
