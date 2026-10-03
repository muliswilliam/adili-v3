import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { settleLoad } from '../../components/declaration/route-helpers';
import {
  HelpArticle,
  HelpArticleNotFound,
  HelpShell,
  HelpUnavailable,
} from '../../components/help/help-pages';
import { topicOf, topicQuery } from '../../help/topics';
import { readHelpPassage, searchHelpPages } from '../../server/help';

/** How many related passages an article lists. */
const RELATED = 3;

const searchSchema = z.object({ lang: z.enum(['en', 'sw']).optional().catch(undefined) });

/**
 * One passage of the law or one help article (spec 11 FE-3), with others on its topic. Opened
 * from the help pages, a help search hit, or "Read in help" under an Ask Adili citation.
 */
export const Route = createFileRoute('/help/$passageId')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ language: search.lang ?? 'en' }),
  loader: async ({ params, deps, location }) => {
    const { language } = deps;
    const read = settleLoad(
      await readHelpPassage({ data: { passageId: params.passageId, language } }),
      location.href,
    );
    if (read.status !== 'ok') return { status: 'unavailable' as const };
    const { passage } = read;
    const found = await searchHelpPages({
      data: { q: topicQuery(topicOf(passage.tags), language), language, limit: RELATED + 1 },
    });
    const related =
      found.status === 'ok'
        ? found.passages.filter((other) => other.id !== passage.id).slice(0, RELATED)
        : null;
    return { status: 'ok' as const, passage, related };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.status === 'ok'
            ? `${loaderData.passage.title} · Adili Online`
            : 'Help · Adili Online',
      },
    ],
  }),
  component: HelpArticleRoute,
  notFoundComponent: NotFoundRoute,
});

function NotFoundRoute() {
  const { lang } = Route.useSearch();
  const language = lang ?? 'en';
  return (
    <HelpShell language={language}>
      <HelpArticleNotFound language={language} />
    </HelpShell>
  );
}

function HelpArticleRoute() {
  const load = Route.useLoaderData();
  const { lang } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const language = lang ?? 'en';
  return (
    <HelpShell language={language}>
      {load.status === 'ok' ? (
        <HelpArticle
          language={language}
          passage={load.passage}
          related={load.related}
          onLanguage={(next) => {
            void navigate({ search: { lang: next }, replace: true });
          }}
        />
      ) : (
        <HelpUnavailable language={language} />
      )}
    </HelpShell>
  );
}
