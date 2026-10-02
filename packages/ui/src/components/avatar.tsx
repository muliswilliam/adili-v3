import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { initials } from '../lib/initials';

export type AvatarProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The person's name; the avatar shows its initials. */
  name: string;
  /** The signed-in user: the brand gradient instead of the lilac fill. */
  current?: boolean;
};

/**
 * A person's initials in a 24px circle (resize with `className`): lilac for other people, the
 * brand gradient for the signed-in user. Decorative: always show the name beside it.
 */
export function Avatar({ name, current = false, className, ...props }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-current={current || undefined}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-[10px] leading-none font-bold',
        current
          ? 'bg-linear-to-br from-brand/45 to-brand text-primary-foreground'
          : 'bg-ai-subtle text-ai-subtle-foreground',
        className,
      )}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
