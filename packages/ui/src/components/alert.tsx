import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

const alertVariants = cva(
  'relative grid w-full gap-0.5 rounded-lg px-4 py-3.5 text-sm leading-normal [&>svg]:absolute [&>svg]:top-4 [&>svg]:left-4 [&>svg]:size-[18px] [&>svg~*]:pl-[30px]',
  {
    variants: {
      // The prototype kit's .callout-info (neutral), -ok, -warn, -danger, -ai and -brand, and the
      // portal's blue info alert.
      variant: {
        neutral: 'bg-muted text-secondary-foreground',
        info: 'bg-info-subtle text-info-subtle-foreground',
        success: 'bg-success-subtle text-success-subtle-foreground',
        warning: 'bg-warning-subtle text-warning-subtle-foreground',
        destructive: 'bg-destructive-subtle text-destructive-subtle-foreground',
        ai: 'bg-ai-subtle text-ai-subtle-foreground',
        brand: 'bg-brand-subtle text-brand-subtle-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>;

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('font-semibold', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn(className)} {...props} />;
}
