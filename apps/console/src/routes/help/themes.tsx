import { formatCalendarDate, useToday } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { messages as m } from '../../components/help/messages';
import { themesSearch } from '../../components/help/model';
import { ThemesView } from '../../components/help/themes-view';
import { NoAccess } from '../../components/load-error';
import { Page, PageHead } from '../../components/page';
import { signInRedirect } from '../../components/sign-in-redirect';
import type { QuestionThemeCount } from '../../server/declarations/client';
import { getQuestionThemes } from '../../server/help';
import type { HelpResult } from '../../server/help.server';

/** Question themes of the viewer's own Commission: its administrators and reporting officers. */
export const Route = createFileRoute('/help/themes')({
  // One month is read at a time (the contract's `month`), this one by default.
  validateSearch: themesSearch,
  loaderDeps: ({ search }) => ({ month: search.month }),
  loader: async ({ context, deps, location }): Promise<HelpResult<QuestionThemeCount[]> | null> => {
    const scope = context.help?.scope;
    if (scope?.kind !== 'commission') return null;
    const month = deps.month ?? formatCalendarDate(Date.now()).slice(0, 7);
    const result = await getQuestionThemes({ data: { slug: scope.slug, month } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: `${m.tabThemes} · Adili Online Console` }] }),
  staticData: { crumb: m.tabThemes },
  pendingComponent: () => <ThemesPage result={null} />,
  component: ThemesLoaded,
});

function ThemesLoaded() {
  const result = Route.useLoaderData();
  return <ThemesPage result={result} />;
}

function ThemesPage({ result }: { result: HelpResult<QuestionThemeCount[]> | null }) {
  const { help } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/help/themes' });
  const thisMonth = formatCalendarDate(useToday()).slice(0, 7);
  if (!help) return null;
  if (help.scope.kind !== 'commission') {
    return (
      <Page narrow>
        <PageHead title={m.tabThemes} />
        <NoAccess text={m.themesForbidden} />
      </Page>
    );
  }
  return (
    <ThemesView
      workspace={help}
      result={result}
      search={search}
      thisMonth={thisMonth}
      onSearchChange={(next) => {
        void navigate({ search: next, resetScroll: false });
      }}
    />
  );
}
