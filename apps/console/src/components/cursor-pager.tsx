import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

/** The pager's words, from the list's own messages. */
export interface CursorPagerLabels {
  pagination: string;
  /** "Showing 11-20 imports". */
  pageRange: (from: number, to: number) => string;
  /** "Showing 10 imports": a later page opened from a shared link, its place unknown. */
  pageRows: (count: number) => string;
  previousPage: string;
  nextPage: string;
}

export interface CursorPagerProps {
  labels: CursorPagerLabels;
  /** Rows on show, numbered from the first page when that is known. */
  range: { from: number; to: number } | null;
  rows: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** The kit's cursor pager: the rows shown, then Previous and Next (no page numbers). */
export function CursorPager({
  labels,
  range,
  rows,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: CursorPagerProps) {
  return (
    <nav
      aria-label={labels.pagination}
      className="flex items-center gap-1.5 border-t px-4 py-2.5 text-[13.5px] text-muted-foreground"
    >
      <span aria-live="polite" className="mr-auto">
        {range ? labels.pageRange(range.from, range.to) : labels.pageRows(rows)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={labels.previousPage}
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={labels.nextPage}
        disabled={!hasNext}
        onClick={onNext}
      >
        <Icon icon={ArrowRight01Icon} />
      </Button>
    </nav>
  );
}
