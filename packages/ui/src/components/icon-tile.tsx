import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { toneClassNames } from '../lib/tone';

export const iconTileVariants = cva(
  'flex shrink-0 items-center justify-center rounded-lg [&_svg]:shrink-0',
  {
    variants: {
      /** The `Badge` tones, and `art`: white on the photo panel beside the signed-out pages. */
      tone: { ...toneClassNames, art: 'bg-art-tile text-brand' },
      /** `sm`: 32px with a 17px icon, in the photo panel's list (the kit's `.art-item .ico`). */
      size: {
        default: 'size-[34px] [&_svg]:size-[18px]',
        sm: 'size-8 [&_svg]:size-[17px]',
      },
    },
    defaultVariants: { tone: 'default', size: 'default' },
  },
);

export type IconTileProps = ComponentProps<'span'> & VariantProps<typeof iconTileVariants>;

/**
 * A 34px decorative tile holding one 18px icon, beside a dialog title, card title or list row:
 * the kit's `.card-head .ico`. Hidden from assistive technology; the text next to it carries the
 * meaning.
 */
export function IconTile({ className, tone, size, ...props }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(iconTileVariants({ tone, size }), className)}
      {...props}
    />
  );
}
