import { Alert, AlertDescription, AlertTitle, Badge, cn, Icon } from '@adili/ui';
import { AlertCircleIcon, UserRemove01Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { formatDateTime } from './format-date-time';

/** Marks a roster record whose identity check against the national register failed. */
export function IdentityMismatchBadge() {
  return (
    <Badge variant="destructive">
      <Icon icon={AlertCircleIcon} strokeWidth={2.2} />
      Identity check failed
    </Badge>
  );
}

export type IdentityMismatchFilterChipProps = Omit<
  ComponentProps<'button'>,
  'children' | 'onClick' | 'type'
> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** How many records failed the check, when known. */
  count?: number;
};

/**
 * The records list's "Identity check failed" toggle, next to "Flagged only". Pair it with
 * `toggleIdentityMismatch` and `rosterRecordsQuery` (`identityMismatch=true`).
 */
export function IdentityMismatchFilterChip({
  pressed,
  onPressedChange,
  count,
  className,
  ...props
}: IdentityMismatchFilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => {
        onPressedChange(!pressed);
      }}
      className={cn(
        'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-3.5',
        pressed
          ? 'bg-foreground text-background'
          : 'bg-card text-secondary-foreground shadow-control hover:text-foreground',
        className,
      )}
      {...props}
    >
      <Icon icon={UserRemove01Icon} />
      Identity check failed
      {count === undefined ? null : (
        <>
          {' '}
          <span className="text-xs tabular-nums opacity-70">
            {count} <span className="sr-only">records</span>
          </span>
        </>
      )}
    </button>
  );
}

/** Record detail callout: when the check failed and what the reporting officer should do. */
export function IdentityMismatchCallout({ at }: { at: string }) {
  return (
    <Alert variant="destructive" role="status">
      <Icon icon={UserRemove01Icon} />
      <AlertTitle>Identity check failed on {formatDateTime(at)}.</AlertTitle>
      <AlertDescription>
        Name or national ID does not match the national register. Correct it in your next import.
      </AlertDescription>
    </Alert>
  );
}
