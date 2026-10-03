import { cn, focusRing, Icon, Tooltip } from '@adili/ui';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

/** A small (i) that explains what is beside it, on hover and focus. */
export function InfoTip({
  label,
  content,
  className,
}: {
  label: string;
  content: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label={label}
        className={cn(
          focusRing,
          'inline-grid size-[18px] shrink-0 cursor-help place-items-center rounded-full align-[-3px] text-muted-foreground hover:text-foreground',
          className,
        )}
      >
        <Icon icon={InformationCircleIcon} className="size-[15px]" />
      </button>
    </Tooltip>
  );
}
