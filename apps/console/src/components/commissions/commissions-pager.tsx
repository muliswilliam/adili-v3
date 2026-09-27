import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';

import { messages } from './messages';

export interface CommissionsPagerProps {
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** While the next page is on its way. */
  busy?: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** The kit's cursor pager: the rows shown, then Previous and Next (no page numbers or total). */
export function CommissionsPager({
  from,
  to,
  hasPrevious,
  hasNext,
  busy = false,
  onPrevious,
  onNext,
}: CommissionsPagerProps) {
  return (
    <nav
      aria-label={messages.pager.label}
      className="flex items-center gap-1.5 border-t px-4 py-2.5 text-[13.5px] text-muted-foreground"
    >
      <span aria-live="polite" className="mr-auto">
        {messages.pager.range(from, to)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={messages.pager.previous}
        disabled={!hasPrevious || busy}
        onClick={onPrevious}
      >
        <Icon icon={ArrowLeft01Icon} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 [&_svg]:size-4"
        aria-label={messages.pager.next}
        aria-busy={busy || undefined}
        disabled={!hasNext || busy}
        onClick={onNext}
      >
        <Icon icon={ArrowRight01Icon} />
      </Button>
    </nav>
  );
}
