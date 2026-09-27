import { cn, Icon } from '@adili/ui';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

export type NativeSelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  /** `sm` is the 36px toolbar size. */
  size?: 'default' | 'sm';
};

/**
 * A native select styled like Input (the kit's `.select`). Candidate for `@adili/ui` once a second
 * screen needs it.
 */
export function NativeSelect({ className, size = 'default', ...props }: NativeSelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        className={cn(
          'flex w-full min-w-0 appearance-none rounded-lg border-0 bg-control pl-3 shadow-control transition-shadow outline-none hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
          size === 'sm' ? 'h-9 pr-9 text-sm' : 'h-11 pr-10 text-[15px]',
        )}
        {...props}
      />
      <Icon
        icon={ArrowDown01Icon}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-secondary-foreground"
      />
    </div>
  );
}
