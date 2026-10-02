import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { NOTICES_COPY as COPY } from '../../../access/notice-copy';
import { NoticesList } from '../../../components/access-notices/notices-list';
import { NoticesShell, UnavailableAlert } from '../../../components/access-notices/notices-shell';
import { signInRedirect } from '../../../components/declaration/route-helpers';
import { getMyAccessNotices } from '../../../server/access-notices';

/**
 * Access requests (spec 10 FE-4): the requests someone made to see the declarant's declaration,
 * open windows first, ten earlier ones to a page (`?page=2`). The access service's "someone has
 * requested access" SMS and email link here.
 */
export const Route = createFileRoute('/access/notices/')({
  validateSearch: z.object({
    page: z.coerce.number().int().min(1).optional().catch(undefined),
  }),
  loader: async ({ location }) => {
    const result = await getMyAccessNotices();
    if (result.status === 'unauthenticated') throw signInRedirect(location.href);
    return result;
  },
  head: () => ({ meta: [{ title: 'Access requests · Adili Online' }] }),
  component: NoticesRoute,
});

function NoticesRoute() {
  const result = Route.useLoaderData();
  const { page } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <NoticesShell>
      <main className="mx-auto grid w-full max-w-[880px] flex-1 content-start gap-6 px-4 pt-5 pb-16 sm:px-7 sm:pt-8">
        <div className="grid gap-3">
          <Button asChild variant="ghost" size="sm" className="justify-self-start">
            <Link to="/">
              <Icon icon={ArrowLeft01Icon} />
              {COPY.home}
            </Link>
          </Button>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[28px]">
            {COPY.title}
          </h1>
        </div>
        {result.status === 'ok' ? (
          <NoticesList
            notices={result.notices}
            page={page ?? 1}
            now={result.now}
            onPage={(next) => {
              void navigate({ search: { page: next === 1 ? undefined : next } });
              window.scrollTo(0, 0);
            }}
          />
        ) : (
          <UnavailableAlert title={COPY.unavailableTitle} text={COPY.unavailableText} />
        )}
      </main>
    </NoticesShell>
  );
}
