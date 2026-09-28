import { Button, Icon } from '@adili/ui';
import { Key01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link } from '@tanstack/react-router';

import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { ApiDocs } from '../../../components/roster/api-docs';
import { messages as m } from '../../../components/roster/messages';
import { getRosterApiEndpoints } from '../../../server/roster-api-credential';

/**
 * The roster API for the Commission's IT team (spec 02, #55). Anyone in the Roster workspace may
 * read it (a commission admin can pass it on); the credentials themselves are the reporting
 * officer's.
 */
export const Route = createFileRoute('/roster/api-access/docs')({
  loader: async ({ context }) => {
    if (!context.workspace) return null;
    return getRosterApiEndpoints();
  },
  head: () => ({ meta: [{ title: `${m.docsTitle} · Adili Online Console` }] }),
  staticData: { crumb: m.docsCrumb },
  component: ApiDocsPage,
});

function ApiDocsPage() {
  const endpoints = Route.useLoaderData();
  const { workspace, tenant } = Route.useRouteContext();
  if (!workspace || !endpoints) return null;
  return (
    <Page>
      <PageHead
        title={m.docsTitle}
        actions={
          workspace.readOnly ? null : (
            <Button asChild variant="secondary">
              <Link to="/roster/api-access">
                <Icon icon={Key01Icon} />
                {m.docsCredentials}
              </Link>
            </Button>
          )
        }
      >
        <p className="mt-1 max-w-[720px] text-[14.5px] text-muted-foreground">{m.docsIntro}</p>
      </PageHead>
      {tenant ? (
        <ApiDocs slug={tenant} endpoints={endpoints} />
      ) : (
        <LoadError title={m.docsErrorTitle} detail={m.errorDetail} retryLabel={m.tryAgain} />
      )}
    </Page>
  );
}
