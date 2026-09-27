import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export const badgeVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center gap-[5px] rounded-full px-[9px] text-[12.5px] font-medium whitespace-nowrap [&_svg]:size-[13px] [&_svg]:shrink-0',
  {
    variants: {
      // The prototype kit's .badge and its -ok, -warn, -danger, -info, -brand and -ai tints.
      // Pair the colour with text or an icon; never rely on colour alone.
      variant: {
        default: 'bg-muted text-secondary-foreground',
        success: 'bg-success-subtle text-success',
        warning: 'bg-warning-subtle text-warning',
        destructive: 'bg-destructive-subtle text-destructive',
        info: 'bg-info-subtle text-info-subtle-foreground',
        brand: 'bg-brand-subtle text-brand-subtle-foreground',
        ai: 'bg-ai-subtle text-ai',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
