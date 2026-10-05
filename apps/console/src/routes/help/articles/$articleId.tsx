import { Button, Card, EmptyState, formatCalendarDate, Icon, useToday } from '@adili/ui';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';

import { ArticleEditor } from '../../../components/help/article-editor';
import { messages as m } from '../../../components/help/messages';
import { LoadError } from '../../../components/load-error';
import { Page, PageHead } from '../../../components/page';
import { goToSignIn, signInRedirect } from '../../../components/sign-in-redirect';
import type { HelpArticle } from '../../../server/declarations/client';
import { listHelpArticles, saveArticle } from '../../../server/help';
import type { HelpResult } from '../../../server/help.server';

/** One article: the service lists them whole, so the page finds it in the list. */
export const Route = createFileRoute('/help/articles/$articleId')({
  loaderDeps: ({ search }) => ({ scope: search.scope }),
  loader: async ({ context, location, params }): Promise<HelpResult<HelpArticle | null> | null> => {
    if (!context.help) return null;
    const result = await listHelpArticles({ data: { scope: context.help.scope } });
    if (!result.ok && result.error.kind === 'unauthenticated') throw signInRedirect(location.href);
    if (!result.ok) return result;
    return { ok: true, data: result.data.find((each) => each.id === params.articleId) ?? null };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData?.ok && loaderData.data ? loaderData.data.title : m.title} · Adili Online Console`,
      },
    ],
  }),
  staticData: {
    crumb: ({ loaderData }) => {
      const data = loaderData as HelpResult<HelpArticle | null> | null | undefined;
      return data?.ok && data.data ? data.data.title : m.articleNotFound;
    },
  },
  component: EditArticle,
});

function EditArticle() {
  const { help } = Route.useRouteContext();
  const result = Route.useLoaderData();
  const router = useRouter();
  const today = formatCalendarDate(useToday());
  if (!help || !result) return null;
  if (!result.ok) {
    return (
      <Page narrow>
        <PageHead title={m.title} />
        <LoadError title={m.loadErrorTitle} detail={m.loadErrorDetail} retryLabel={m.tryAgain} />
      </Page>
    );
  }
  if (!result.data) {
    return (
      <Page narrow>
        <Card className="p-0 sm:p-0">
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.articleNotFound}
            description={m.articleNotFoundText}
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/help">{m.backToArticles}</Link>
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }
  return (
    <ArticleEditor
      key={`${result.data.id}:${String(result.data.version)}`}
      workspace={help}
      article={result.data}
      today={today}
      save={(data) => saveArticle({ data })}
      onSaved={() => {
        void router.invalidate();
      }}
      onUnauthenticated={() => {
        goToSignIn();
      }}
    />
  );
}
