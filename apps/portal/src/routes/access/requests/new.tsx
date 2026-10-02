import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { FORM_K_COPY } from '../../../access/copy';
import { AccessShell } from '../../../components/access/access-shell';
import { FormKWizard } from '../../../components/access/form-k-wizard';
import { NotApplicantNotice, UnavailableNotice } from '../../../components/access/request-status';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { getNewAccessRequest, submitAccessRequest } from '../../../server/access-requests';

/**
 * Form K (spec 10 FE-3): a new access request, in six steps; `?from=<id>` starts from an
 * earlier request's details (after a Commission could not identify the officer).
 */
export const Route = createFileRoute('/access/requests/new')({
  validateSearch: z.object({ from: z.uuid().optional().catch(undefined) }),
  loaderDeps: ({ search }) => ({ from: search.from }),
  loader: async ({ deps, location }) => {
    const result = await getNewAccessRequest({ data: { from: deps.from } });
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: 'New request · Adili Online' }] }),
  component: NewRequestRoute,
});

function NewRequestRoute() {
  const result = Route.useLoaderData();
  const navigate = useNavigate();
  return (
    <AccessShell current="new">
      {result.status === 'ok' ? (
        <FormKWizard
          applicant={result.applicant}
          commissions={result.commissions}
          now={Date.parse(result.now)}
          {...(result.draft ? { initialDraft: result.draft, initialStep: 'officer' } : {})}
          submit={(data) => submitAccessRequest({ data })}
          onSubmitted={({ id }) => {
            void navigate({ to: '/access/requests/$id/submitted', params: { id } });
          }}
        />
      ) : (
        <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-6 px-4 pt-6 pb-16 sm:px-7 sm:pt-10">
          {result.status === 'not-applicant' ? (
            <NotApplicantNotice />
          ) : (
            <UnavailableNotice
              title={FORM_K_COPY.loadUnavailableTitle}
              text={FORM_K_COPY.loadUnavailableText}
            />
          )}
        </main>
      )}
    </AccessShell>
  );
}
