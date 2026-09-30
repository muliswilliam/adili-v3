import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { toneClassNames } from '../lib/tone';

export const iconTileVariants = cva(
  'flex size-[34px] shrink-0 items-center justify-center rounded-lg [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: { tone: toneClassNames },
    defaultVariants: { tone: 'default' },
  },
);

export type IconTileProps = ComponentProps<'span'> & VariantProps<typeof iconTileVariants>;

/**
 * A 34px decorative tile holding one icon, beside a dialog title, card title or list row: the
 * kit's `.card-head .ico`. Hidden from assistive technology; the text next to it carries the
 * meaning.
 */
export function IconTile({ className, tone, ...props }: IconTileProps) {
  return (
    <span aria-hidden="true" className={cn(iconTileVariants({ tone }), className)} {...props} />
  );
}
