import { HugeiconsIcon, type HugeiconsIconProps } from '@hugeicons/react';

import { cn } from '../lib/cn';

export type IconProps = HugeiconsIconProps;

/**
 * A Hugeicons icon (the style guide's icon family), 16px and decorative by default.
 * Pass icons from `@hugeicons/core-free-icons`, e.g. `<Icon icon={Search01Icon} />`.
 */
export function Icon({ className, strokeWidth = 1.75, ...props }: IconProps) {
  return (
    <HugeiconsIcon
      aria-hidden="true"
      strokeWidth={strokeWidth}
      className={cn('size-4 shrink-0', className)}
      {...props}
    />
  );
}
