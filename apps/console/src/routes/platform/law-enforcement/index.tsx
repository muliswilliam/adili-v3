import { Icon } from '@adili/ui';
import { Shield01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute } from '@tanstack/react-router';

import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { AgenciesTable } from '../../../components/platform/agencies-table';
import { messages as m } from '../../../components/platform/messages';
import { signInRedirect } from '../../../components/sign-in-redirect';
import { getLeaAgencies } from '../../../server/lea-accounts';

/** The law enforcement agencies and their officer accounts (spec 10 FE-6). */
export const Route = createFileRoute('/platform/law-enforcement/')({
  staticData: { hideBreadcrumbs: true },
  loader: async ({ location, context }) => {
    if (!context.workspace) return null;
    const result = await getLeaAgencies();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  component: AgenciesRoute,
});

function AgenciesRoute() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return (
    <Page>
      <PageHead title={m.title} />
      {result.ok ? (
        <>
          <AgenciesTable agencies={result.data} />
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground">
            <Icon icon={Shield01Icon} className="size-3.5" />
            {m.agenciesNote}
          </p>
        </>
      ) : (
        <LoadError
          title={m.agenciesErrorTitle}
          detail={m.agenciesErrorDetail}
          retryLabel={m.tryAgain}
        />
      )}
    </Page>
  );
}
