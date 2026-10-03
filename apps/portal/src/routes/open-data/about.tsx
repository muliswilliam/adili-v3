import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AboutView } from '../../components/open-data/about-view';
import { OpenDataShell } from '../../components/open-data/open-data-shell';
import { aboutCopy, languageOf } from '../../open-data/copy';
import { getOpenDataApiBase } from '../../server/open-data';

/** About this data (spec 09b FE-4): definitions, columns and the public API; `?lang=sw`. */
export const Route = createFileRoute('/open-data/about')({
  validateSearch: z.object({ lang: z.enum(['sw']).optional().catch(undefined) }),
  loader: () => getOpenDataApiBase(),
  head: ({ match }) => ({ meta: [{ title: aboutCopy(languageOf(match.search.lang)).metaTitle }] }),
  component: AboutRoute,
});

function AboutRoute() {
  const apiBase = Route.useLoaderData();
  const { lang } = Route.useSearch();
  const language = languageOf(lang);
  return (
    <OpenDataShell current="about" language={language}>
      <AboutView language={language} apiBase={apiBase} />
    </OpenDataShell>
  );
}
