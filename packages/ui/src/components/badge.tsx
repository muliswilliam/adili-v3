import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { toneClassNames } from '../lib/tone';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-[5px] whitespace-nowrap [&_svg]:shrink-0',
  {
    variants: {
      variant: toneClassNames,
      /**
       * `default`: the kit's 24px pill. `tag`: a 22px square-cornered tag, the kit's `.cite-tag`
       * (a citation such as "Act s.31(4)" or "Help").
       */
      size: {
        default: 'h-6 rounded-full px-[9px] text-[12.5px] font-medium [&_svg]:size-[13px]',
        tag: 'h-[22px] rounded-md px-2 text-[12px] font-semibold [&_svg]:size-3',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, size }), className)} {...props} />;
}
