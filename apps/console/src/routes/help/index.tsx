import { formatCalendarDate, useToday } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ArticlesView } from '../../components/help/articles-view';
import { messages as m } from '../../components/help/messages';
import { articlesSearch } from '../../components/help/model';
import { signInRedirect } from '../../components/sign-in-redirect';
import type { HelpArticle } from '../../server/declarations/client';
import { listHelpArticles } from '../../server/help';
import type { HelpResult } from '../../server/help.server';

export const Route = createFileRoute('/help/')({
  // Search, status and page apply in the browser: the articles are read once per visit.
  validateSearch: articlesSearch,
  shouldReload: ({ cause }) => cause !== 'stay',
  loader: async ({ context, location }): Promise<HelpResult<HelpArticle[]> | null> => {
    if (!context.help) return null;
    const result = await listHelpArticles({ data: { scope: context.help.scope } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.title} · Adili Online Console` }] }),
  pendingComponent: () => <ArticlesPage result={null} />,
  component: ArticlesLoaded,
});

function ArticlesLoaded() {
  const result = Route.useLoaderData();
  if (!result) return null;
  return <ArticlesPage result={result} />;
}

function ArticlesPage({ result }: { result: HelpResult<HelpArticle[]> | null }) {
  const { help } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/help/' });
  const today = formatCalendarDate(useToday());
  if (!help) return null;
  return (
    <ArticlesView
      workspace={help}
      result={result}
      search={search}
      today={today}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
    />
  );
}
