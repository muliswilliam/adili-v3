import {
  Button,
  Card,
  cn,
  EmptyState,
  FilterChip,
  formatDate,
  Icon,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from '@adili/ui';
import { Add01Icon, File01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import type { HelpArticle } from '../../server/declarations/client';
import type { HelpResult } from '../../server/help.server';
import { CursorPager } from '../cursor-pager';
import { LoadError } from '../load-error';
import { Page } from '../page';
import { clientPage } from '../paging';
import { SearchBox } from '../search-box';
import { messages as m } from './messages';
import {
  ARTICLE_STATUSES,
  articleStatus,
  type ArticlesSearch,
  ARTICLES_PAGE_SIZE,
  filterArticles,
  statusCounts,
} from './model';
import { ArticleStatusBadge, HelpHeader, inEffect, Languages } from './parts';
import type { HelpWorkspace } from './scope';
import { HelpSearchButton } from './help-search-button';

export interface ArticlesViewProps {
  workspace: HelpWorkspace;
  /** The articles; null while they load. */
  result: HelpResult<HelpArticle[]> | null;
  search: ArticlesSearch;
  onSearchChange: (next: ArticlesSearch) => void;
  /** Today in Nairobi, `YYYY-MM-DD`: what is in force. */
  today: string;
}

/**
 * Help articles (spec 11 FE-4): the Commission's (or the platform's) articles, last updated
 * first, with their status, languages and period in force. Search, status filter and page apply
 * in the browser: the list is read whole. Reporting officers read; administrators write.
 */
export function ArticlesView({
  workspace,
  result,
  search,
  onSearchChange,
  today,
}: ArticlesViewProps) {
  const id = useId();
  const articles = result?.ok ? result.data : null;
  const counts = articles ? statusCounts(articles, today) : null;
  const shown = articles ? filterArticles(articles, search, today) : [];
  const page = clientPage(shown, search.page, ARTICLES_PAGE_SIZE);
  const filtered = Boolean(search.q) || Boolean(search.status);
  const setFilters = (patch: Pick<ArticlesSearch, 'q' | 'status'>) => {
    onSearchChange({ ...search, ...patch, page: undefined });
  };
  const canWrite = !workspace.readOnly;

  return (
    <Page>
      <HelpHeader
        workspace={workspace}
        current="articles"
        actions={
          <>
            <HelpSearchButton scope={workspace.scope} />
            {canWrite ? (
              <Button asChild>
                <Link to="/help/articles/new">
                  <Icon icon={Add01Icon} />
                  {m.newArticle}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <Card className="overflow-hidden p-0 sm:p-0">
        <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <SearchBox
            id={`${id}-search`}
            label={m.searchLabel}
            placeholder={m.searchPlaceholder}
            maxLength={100}
            applied={search.q ?? ''}
            disabled={articles === null}
            onSearch={(value) => {
              setFilters({ q: value || undefined, status: search.status });
            }}
          />
          <div role="group" aria-label={m.statusFilterLabel} className="flex flex-wrap gap-1.5">
            {(['all', ...ARTICLE_STATUSES] as const).map((each) => (
              <FilterChip
                key={each}
                pressed={(search.status ?? 'all') === each}
                disabled={articles === null}
                count={counts ? counts[each] : undefined}
                countLabel={m.filterCountLabel}
                onPressedChange={() => {
                  setFilters({
                    q: search.q,
                    status: each === 'all' || search.status === each ? undefined : each,
                  });
                }}
              >
                {each === 'all' ? m.statusAll : m.status[each]}
              </FilterChip>
            ))}
          </div>
        </div>
        {result && !result.ok ? (
          <div className="p-4">
            <LoadError
              title={m.loadErrorTitle}
              detail={m.loadErrorDetail}
              retryLabel={m.tryAgain}
            />
          </div>
        ) : articles === null ? (
          <ArticlesSkeleton />
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<Icon icon={File01Icon} />}
            title={m.emptyTitle}
            description={workspace.scope.kind === 'platform' ? m.emptyPlatform : m.emptyCommission}
            action={
              canWrite ? (
                <Button asChild size="sm">
                  <Link to="/help/articles/new">
                    <Icon icon={Add01Icon} />
                    {m.newArticle}
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Search01Icon} />}
            title={m.noMatchesTitle}
            description={m.noMatchesText}
            action={
              filtered ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    onSearchChange({});
                  }}
                >
                  {m.clearFilters}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <Table caption={m.caption}>
              <TableHeader className="max-sm:sr-only">
                <TableRow>
                  <TableHead>{m.columnTitle}</TableHead>
                  <TableHead>{m.columnStatus}</TableHead>
                  <TableHead>{m.columnLanguages}</TableHead>
                  <TableHead>{m.columnInEffect}</TableHead>
                  <TableHead>{m.columnUpdated}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((article) => (
                  <ArticleRow key={article.id} article={article} today={today} />
                ))}
              </TableBody>
            </Table>
            {page.pages > 1 ? (
              <CursorPager
                labels={{
                  pagination: m.pagination,
                  pageRange: (from, to) => m.pageRange(from, to, shown.length),
                  pageRows: m.pageRows,
                  previousPage: m.previousPage,
                  nextPage: m.nextPage,
                }}
                range={{ from: page.from, to: page.to }}
                rows={page.rows.length}
                hasPrevious={page.page > 1}
                hasNext={page.page < page.pages}
                onPrevious={() => {
                  onSearchChange({ ...search, page: page.page > 2 ? page.page - 1 : undefined });
                }}
                onNext={() => {
                  onSearchChange({ ...search, page: page.page + 1 });
                }}
              />
            ) : null}
          </>
        )}
      </Card>
    </Page>
  );
}

const PHONE_ROW = 'max-sm:grid max-sm:gap-y-1.5 max-sm:px-4 max-sm:py-3.5';
const PHONE_LINE = 'max-sm:inline-flex max-sm:p-0 max-sm:first:pl-0 max-sm:last:pr-0';

function ArticleRow({ article, today }: { article: HelpArticle; today: string }) {
  return (
    <TableRow className={PHONE_ROW}>
      <TableHead
        scope="row"
        className="min-w-[260px] py-3 font-normal whitespace-normal max-sm:min-w-0 max-sm:p-0 max-sm:first:pl-0"
      >
        <TableRowLink asChild>
          <Link to="/help/articles/$articleId" params={{ articleId: article.id }}>
            {article.title}
          </Link>
        </TableRowLink>
        <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
          {article.tags.length ? article.tags.map((tag) => m.tag[tag]).join(', ') : m.noTags}
        </span>
      </TableHead>
      <TableCell className={PHONE_LINE}>
        <ArticleStatusBadge status={articleStatus(article, today)} />
      </TableCell>
      <TableCell className={PHONE_LINE}>
        <Languages kiswahili={article.bodySw !== null} />
      </TableCell>
      <TableCell
        className={cn(
          'whitespace-nowrap',
          PHONE_LINE,
          'max-sm:text-[13px] max-sm:text-muted-foreground',
        )}
      >
        {inEffect(article)}
      </TableCell>
      <TableCell
        className={cn(
          'whitespace-nowrap',
          PHONE_LINE,
          'max-sm:text-[13px] max-sm:text-muted-foreground',
        )}
      >
        {formatDate(article.updatedAt)}
        <span className="block text-[12.5px] text-muted-foreground max-sm:ml-1.5 max-sm:inline">
          {m.version(article.version)}
        </span>
      </TableCell>
    </TableRow>
  );
}

function ArticlesSkeleton() {
  return (
    <Table caption={m.caption} aria-busy="true">
      <TableBody>
        {Array.from({ length: 6 }, (_, row) => (
          <TableRow key={row}>
            <TableCell>
              <Skeleton className="w-60 max-w-full" />
              <Skeleton className="mt-1.5 w-24" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-20" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-14" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-28" />
            </TableCell>
            <TableCell>
              <Skeleton className="w-20" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
