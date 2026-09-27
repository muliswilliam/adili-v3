import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export function DescriptionList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('divide-y', className)} {...props} />;
}

export type DescriptionItemProps = ComponentProps<'div'> & {
  term: ReactNode;
};

/** A term on the left and its value right-aligned, rows split by hairlines (the kit's .dl). */
export function DescriptionItem({ term, className, children, ...props }: DescriptionItemProps) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4 py-[11px] text-[14.5px] first:pt-0 last:pb-0',
        className,
      )}
      {...props}
    >
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 text-right font-medium break-words">{children}</dd>
    </div>
  );
}
