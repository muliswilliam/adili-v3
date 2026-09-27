import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { messages as m } from './messages';

export interface CommissionsPagerProps {
  /** Rows on show, numbered from the first page when that is known. */
  range: { from: number; to: number } | null;
  rows: number;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** The kit's cursor pager: the rows shown, then Previous and Next (no page numbers). */
export function CommissionsPager({
  range,
  rows,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: CommissionsPagerProps) {
  return (
    <nav
      aria-label={m.pagination}
      className="flex items-center gap-1.5 border-t px-4 py-2.5 text-[13.5px] text-muted-foreground"
    >
      <span aria-live="polite" className="mr-auto">
        {range ? m.pageRange(range.from, range.to) : m.pageRows(rows)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={m.previousPage}
        disabled={!hasPrevious}
        onClick={onPrevious}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={m.nextPage}
        disabled={!hasNext}
        onClick={onNext}
      >
        <Icon icon={ArrowRight01Icon} />
      </Button>
    </nav>
  );
}
