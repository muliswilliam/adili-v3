import { Card, CardContent } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { Page, PageHead } from '../../components/page';
import { signInRedirect } from '../../components/sign-in-redirect';
import { messages as t } from '../../components/support/messages';
import { PersonLookupForm, PersonLookupResult } from '../../components/support/person-lookup';
import { lookUpPerson, OFR_PATTERN } from '../../server/account-support';
import type { ServiceResult } from '../../server/service-call';
import type { PersonSummary } from '../../server/support/types';

const searchSchema = z.object({ ofr: z.string().regex(OFR_PATTERN).optional() });

/** The helpdesk's person lookup: the reference in the URL, so a lookup survives a reload. */
export const Route = createFileRoute('/support/')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps, location }): Promise<ServiceResult<PersonSummary> | null> => {
    if (!context.workspace || !deps.ofr) return null;
    const result = await lookUpPerson({ data: { ofr: deps.ofr } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${t.title} · Adili Online Console` }] }),
  component: SupportPage,
});

function SupportPage() {
  const result = Route.useLoaderData();
  const { ofr } = Route.useSearch();
  const navigate = useNavigate({ from: '/support/' });
  return (
    <Page narrow>
      <PageHead title={t.title}>
        <p className="mt-1.5 max-w-[680px] text-[14px] text-muted-foreground">{t.intro}</p>
      </PageHead>
      <div className="grid gap-5">
        <Card>
          <CardContent>
            <PersonLookupForm
              key={ofr ?? ''}
              applied={ofr}
              onLookUp={(value) => {
                void navigate({ search: { ofr: value } });
              }}
            />
          </CardContent>
        </Card>
        {result ? <PersonLookupResult result={result} /> : null}
      </div>
    </Page>
  );
}
