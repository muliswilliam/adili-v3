import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';

export function DescriptionList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('divide-y', className)} {...props} />;
}

export type DescriptionItemProps = ComponentProps<'div'> & {
  term: ReactNode;
};

export function DescriptionItem({ term, className, children, ...props }: DescriptionItemProps) {
  return (
    <div
      className={cn('grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-3 sm:gap-4', className)}
      {...props}
    >
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-sm font-medium break-words sm:col-span-2">{children}</dd>
    </div>
  );
}
