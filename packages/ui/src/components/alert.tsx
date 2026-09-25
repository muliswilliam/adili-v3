import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

const alertVariants = cva(
  'relative grid w-full gap-1 rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:top-3.5 [&>svg]:left-4 [&>svg]:size-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        info: 'bg-card text-card-foreground',
        warning:
          'border-transparent bg-warning-subtle text-warning-subtle-foreground [&>svg]:text-current',
        destructive:
          'border-transparent bg-destructive-subtle text-destructive-subtle-foreground [&>svg]:text-current',
      },
    },
    defaultVariants: { variant: 'info' },
  },
);

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('leading-5 font-medium', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('leading-5 opacity-90', className)} {...props} />;
}
