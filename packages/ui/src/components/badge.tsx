import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { toneClassNames } from '../lib/tone';

export const badgeVariants = cva(
  'inline-flex h-6 w-fit shrink-0 items-center gap-[5px] rounded-full px-[9px] text-[12.5px] font-medium whitespace-nowrap [&_svg]:size-[13px] [&_svg]:shrink-0',
  {
    variants: { variant: toneClassNames },
    defaultVariants: { variant: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
