import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)]',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 p-6', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3 className={cn('text-base leading-6 font-semibold tracking-tight', className)} {...props} />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center border-t px-6 py-4', className)} {...props} />;
}
