import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { settleLoad } from '../../components/declaration/route-helpers';
import { HelpHome, type HelpListing, HelpShell } from '../../components/help/help-pages';
import { HELP_COPY } from '../../help/copy';
import { TOPIC_KEYS, topicQuery } from '../../help/topics';
import { searchHelpPages } from '../../server/help';

/**
 * Help (spec 11 FE-3): topics, a topic's passages and search, all through the help search
 * endpoint (`?q=`, `?topic=`), in English or Kiswahili (`?lang=sw`).
 */
export const Route = createFileRoute('/help/')({
  validateSearch: z.object({
    q: z.string().max(200).optional().catch(undefined),
    topic: z.enum(TOPIC_KEYS).optional().catch(undefined),
    lang: z.enum(['en', 'sw']).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => ({
    q: search.q?.trim() ?? '',
    topic: search.topic,
    language: search.lang ?? 'en',
  }),
  loader: async ({ deps, location }): Promise<HelpListing> => {
    const { q, topic, language } = deps;
    if (q.length < 2 && !topic) return { kind: 'topics' };
    const result = settleLoad(
      await searchHelpPages({
        data: { q: q.length >= 2 ? q : topicQuery(topic ?? 'start', language), language },
      }),
      location.href,
    );
    const passages = result.status === 'ok' ? result.passages : null;
    return q.length >= 2
      ? { kind: 'search', query: q, passages }
      : { kind: 'topic', topic: topic ?? 'start', passages };
  },
  head: ({ match }) => ({
    meta: [{ title: HELP_COPY[match.search.lang ?? 'en'].documentTitle }],
  }),
  component: HelpRoute,
});

function HelpRoute() {
  const listing = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const language = search.lang ?? 'en';
  const onQuery = useCallback(
    (q: string) => {
      void navigate({
        search: (previous) => ({ ...previous, q: q || undefined, topic: undefined }),
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <HelpShell language={language}>
      <HelpHome
        language={language}
        query={search.q?.trim() ?? ''}
        listing={listing}
        onQuery={onQuery}
        onTopic={(topic) => {
          void navigate({
            search: (previous) => ({ ...previous, q: undefined, topic: topic ?? undefined }),
          });
        }}
        onLanguage={(lang) => {
          void navigate({ search: (previous) => ({ ...previous, lang }), replace: true });
        }}
      />
    </HelpShell>
  );
}
