import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/**
 * A white panel with 20px padding. Inputs, textareas and selects inside it switch to their
 * filled style (see `[data-slot='card']` in styles.css).
 */
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('flex flex-col rounded-2xl bg-card p-5 text-card-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-2 pb-8', className)} {...props} />;
}

/** A 24px decorative icon above the title, e.g. `<CardIcon><Icon icon={…} /></CardIcon>`. */
export function CardIcon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('mb-1 text-success [&_svg]:size-6', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      className={cn('text-base leading-4 font-semibold tracking-[-0.02em]', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm leading-[1.6] text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-4', className)} {...props} />;
}

/** Actions under the content; give buttons `flex-1` for the equal-width pair in the design. */
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-3 pt-5', className)} {...props} />;
}
