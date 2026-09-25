import { cn, Icon } from '@adili/ui';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

/** A native select styled like Input. Candidate for `@adili/ui` once a second screen needs it. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className="flex h-8 w-full min-w-0 appearance-none rounded-lg border-0 bg-control pr-8 pl-2.5 text-sm shadow-control transition-shadow outline-none hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:opacity-60"
        {...props}
      />
      <Icon
        icon={ArrowDown01Icon}

        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
