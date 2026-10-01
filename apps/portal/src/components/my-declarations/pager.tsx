import { Button, cn, Icon, Select, SelectItem } from '@adili/ui';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { PAGE_SIZES, type PageSize } from '../../declaration/my-declarations';
import { MY_DECLARATIONS_COPY as COPY } from './copy';

/**
 * The page numbers to offer: the first, the last, and the current one with its neighbours
 * (the first four or last four near either end); `gap` marks numbers skipped before it.
 */
export function pageNumbers(page: number, pages: number): { page: number; gap: boolean }[] {
  const shown = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((near) => shown.add(near));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((near) => shown.add(near));
  let previous = 0;
  return [...shown]
    .filter((number) => number >= 1 && number <= pages)
    .sort((a, b) => a - b)
    .map((number) => {
      const entry = { page: number, gap: number - previous > 1 };
      previous = number;
      return entry;
    });
}

export interface PagerProps {
  page: number;
  pageSize: PageSize;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: PageSize) => void;
}

/** The kit's numbered pager: the range shown, rows per page, previous, the pages, next. */
export function Pager({ page, pageSize, total, onPage, onPageSize }: PagerProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const arrow = 'size-8 [&_svg]:size-4';
  return (
    <nav
      aria-label={COPY.pagination}
      className="flex flex-wrap items-center gap-1.5 rounded-2xl bg-card px-4 py-2.5 text-[13.5px] text-muted-foreground shadow-card"
    >
      <span aria-live="polite">{COPY.range(from, to, total)}</span>
      <span className="flex-1" />
      <label className="mr-2 hidden items-center gap-1.5 text-[13px] sm:flex">
        <span>{COPY.rows}</span>
        <Select
          aria-label={COPY.rowsPerPage}
          className="h-8 w-[72px]"
          value={String(pageSize)}
          onValueChange={(value) => {
            const size = PAGE_SIZES.find((candidate) => String(candidate) === value);
            if (size) onPageSize(size);
          }}
        >
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </Select>
      </label>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={arrow}
        aria-label={COPY.previousPage}
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      <span className="hidden items-center gap-0.5 sm:flex">
        {pageNumbers(page, pages).map((entry) => (
          <span key={entry.page} className="flex items-center gap-0.5">
            {entry.gap ? (
              <span aria-hidden="true" className="min-w-5 text-center">
                …
              </span>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={COPY.page(entry.page)}
              aria-current={entry.page === page ? 'page' : undefined}
              className={cn(
                'size-8 text-[13.5px] tabular-nums',
                entry.page === page &&
                  'bg-foreground text-background hover:bg-foreground hover:text-background',
              )}
              onClick={() => {
                onPage(entry.page);
              }}
            >
              {entry.page}
            </Button>
          </span>
        ))}
      </span>
      <span className="sm:hidden">{COPY.pageOf(page, pages)}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={arrow}
        aria-label={COPY.nextPage}
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        <Icon icon={ArrowRight01Icon} />
      </Button>
    </nav>
  );
}
