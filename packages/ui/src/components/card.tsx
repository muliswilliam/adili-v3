import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** A white panel with a hairline ring, 16px radius and 20px padding (24px from `sm`). */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col rounded-2xl bg-card p-5 text-card-foreground shadow-card sm:p-6',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pb-5', className)} {...props} />;
}

/** A 34px decorative icon tile above the title, e.g. `<CardIcon><Icon icon={…} /></CardIcon>`. */
export function CardIcon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'mb-2 flex size-[34px] items-center justify-center rounded-[9px] bg-muted text-secondary-foreground [&_svg]:size-[18px]',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-base leading-snug font-semibold tracking-[-0.01em]', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-4', className)} {...props} />;
}

/** Actions under the content; give buttons `flex-1` for an equal-width pair. */
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-3 pt-5', className)} {...props} />;
}
