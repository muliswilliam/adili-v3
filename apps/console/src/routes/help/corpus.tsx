import { formatCalendarDate, useToday } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { CorpusView } from '../../components/help/corpus-view';
import { messages as m } from '../../components/help/messages';
import { corpusSearch } from '../../components/help/model';
import { NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { goToSignIn, signInRedirect } from '../../components/sign-in-redirect';
import type { CorpusPassage } from '../../server/declarations/client';
import { getCorpusPassage, importCorpus, listCorpus } from '../../server/help';
import type { HelpResult } from '../../server/help.server';

/** The legal corpus, read-only: platform admins only, as the service has it (403 for others). */
export const Route = createFileRoute('/help/corpus')({
  validateSearch: corpusSearch,
  shouldReload: ({ cause }) => cause !== 'stay',
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: async ({ context, location }): Promise<HelpResult<CorpusPassage[]> | null> => {
    if (context.help?.scope.kind !== 'platform') return null;
    const result = await listCorpus();
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.tabCorpus} · Adili Online Console` }] }),
  staticData: { crumb: m.tabCorpus },
  pendingComponent: () => <CorpusPage result={null} />,
  component: CorpusLoaded,
});

function CorpusLoaded() {
  const result = Route.useLoaderData();
  return <CorpusPage result={result} />;
}

const loadPassage = (passageId: string) => getCorpusPassage({ data: { passageId } });
const reimport = () => importCorpus();
const signIn = () => {
  goToSignIn();
};

function CorpusPage({ result }: { result: HelpResult<CorpusPassage[]> | null }) {
  const { help } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/help/corpus' });
  const today = formatCalendarDate(useToday());
  if (!help) return null;
  if (help.scope.kind !== 'platform') {
    return (
      <Page narrow>
        <PageHead title={m.tabCorpus} />
        <NoAccess text={m.corpusForbidden} />
      </Page>
    );
  }
  return (
    <CorpusView
      workspace={help}
      result={result}
      search={search}
      today={today}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
      loadPassage={loadPassage}
      importCorpus={reimport}
      onUnauthenticated={signIn}
    />
  );
}
