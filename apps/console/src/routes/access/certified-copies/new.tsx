import { Button } from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';

import { messages as m } from '../../../components/access/self-access/messages';
import { RecordApplicationForm } from '../../../components/access/self-access/record-form';
import { NoAccess } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';

/**
 * Recording a written self-access application (spec 10 slice #302): the access officer only;
 * the supervisor, who reads the workspace, is told so.
 */
export const Route = createFileRoute('/access/certified-copies/new')({
  staticData: { crumb: m.newCrumb },
  head: () => ({ meta: [{ title: `${m.newCrumb} · Adili Online Console` }] }),
  component: NewApplication,
});

function NewApplication() {
  const { workspace, tenant } = Route.useRouteContext();
  if (!workspace) return null;
  if (workspace.readOnly || !tenant) {
    return (
      <Page narrow>
        <PageHead title={m.formTitle} />
        <NoAccess
          text={m.supervisorCannotAct}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link to="/access/certified-copies">{m.backToCopies}</Link>
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <Page narrow>
      <RecordApplicationForm slug={tenant} commissionCode={tenant.toUpperCase()} />
    </Page>
  );
}
