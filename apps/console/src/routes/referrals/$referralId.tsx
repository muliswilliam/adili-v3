import { Button, EmptyState, Icon } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, notFound } from '@tanstack/react-router';

import { LoadError } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { messages as t } from '../../components/referrals/messages';
import { ReferralPage } from '../../components/referrals/referral-page';
import { signInRedirect } from '../../components/sign-in-redirect';
import { referralTitle } from '../../referral/view';
import { getReferral } from '../../server/referrals';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The referral's reference, or where it stands, once loaded. */
function referralCrumb(loaderData: unknown): string {
  if (typeof loaderData !== 'object' || loaderData === null || !('ok' in loaderData)) {
    return t.detail.crumb;
  }
  if (!loaderData.ok || !('data' in loaderData)) return t.detail.crumb;
  return referralTitle(loaderData.data as Parameters<typeof referralTitle>[0]);
}

/**
 * One referral to EACC (spec 08 FE-6; S12, S13), with its evidence and package, and Approve and
 * Decline for a supervisor. Another Commission's referral reads as missing.
 */
export const Route = createFileRoute('/referrals/$referralId')({
  loader: async ({ params, location, context }) => {
    if (!context.workspace) throw notFound();
    if (!UUID.test(params.referralId)) throw notFound();
    const result = await getReferral({ data: { referralId: params.referralId } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok && result.error.kind === 'problem') {
      const { status } = result.error.problem;
      if (status === 404 || status === 403) throw notFound();
    }
    return result;
  },
  staticData: { crumb: ({ loaderData }) => referralCrumb(loaderData) },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.ok ? referralTitle(loaderData.data) : t.detail.crumb} · Adili Online Console`,
      },
    ],
  }),
  component: ReferralRoute,
  notFoundComponent: () => (
    <Page narrow>
      <EmptyState
        icon={<Icon icon={Search01Icon} />}
        title={t.detail.notFound.title}
        description={t.detail.notFound.body}
        action={
          <Button asChild variant="secondary" size="sm">
            <Link to="/referrals">{t.detail.notFound.back}</Link>
          </Button>
        }
      />
    </Page>
  ),
});

function ReferralRoute() {
  const load = Route.useLoaderData();
  const { viewer, supervisor, tenant } = Route.useRouteContext();
  if (!load.ok) {
    return (
      <Page narrow>
        <PageHead title={t.detail.crumb} />
        <LoadError
          title={t.detail.loadFailed.title}
          detail={t.detail.loadFailed.body}
          retryLabel={t.detail.loadFailed.retry}
        />
      </Page>
    );
  }
  return (
    <ReferralPage
      key={load.data.id}
      referral={load.data}
      viewer={{ subject: viewer.user.subject, name: viewer.user.name }}
      supervisor={supervisor}
      slug={tenant ?? ''}
    />
  );
}
