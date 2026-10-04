import { formatCalendarDate, useToday } from '@adili/ui';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { z } from 'zod';

import { ArticleEditor } from '../../../components/help/article-editor';
import { messages as m, THEME_TAG } from '../../../components/help/messages';
import { goToSignIn } from '../../../components/sign-in-redirect';
import { QUESTION_THEMES } from '../../../server/declarations/help-tags';
import { saveArticle } from '../../../server/help';

/** A new article; from a question theme, it starts with the theme's name and tag. */
export const Route = createFileRoute('/help/articles/new')({
  validateSearch: z.object({ theme: z.enum(QUESTION_THEMES).optional().catch(undefined) }),
  head: () => ({ meta: [{ title: `${m.newArticle} · Adili Online Console` }] }),
  staticData: { crumb: m.newArticle },
  component: NewArticle,
});

function NewArticle() {
  const { help } = Route.useRouteContext();
  const { theme } = Route.useSearch();
  const navigate = useNavigate();
  const router = useRouter();
  const today = formatCalendarDate(useToday());
  if (!help) return null;
  const tag = theme ? THEME_TAG[theme] : null;
  return (
    <ArticleEditor
      workspace={help}
      article={null}
      initial={theme ? { title: m.theme[theme], tags: tag ? [tag] : [] } : undefined}
      today={today}
      save={(data) => saveArticle({ data })}
      onSaved={(article) => {
        void router.invalidate({ filter: (match) => match.routeId === '/help/' });
        void navigate({
          to: '/help/articles/$articleId',
          params: { articleId: article.id },
          replace: true,
        });
      }}
      onUnauthenticated={() => {
        goToSignIn();
      }}
    />
  );
}
