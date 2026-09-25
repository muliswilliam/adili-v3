import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary-subtle text-primary-subtle-foreground',
        neutral: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        warning: 'border-transparent bg-warning-subtle text-warning-subtle-foreground',
        destructive: 'border-transparent bg-destructive-subtle text-destructive-subtle-foreground',
        success: 'border-transparent bg-success-subtle text-success-subtle-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
