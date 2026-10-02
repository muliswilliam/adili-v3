import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { initials } from '../lib/initials';

/**
 * The fill behind the initials. `default`: lilac (the `avatar` token), for other officers.
 * `brand`, `info` and `success`: gradients for the people of a declaration (the declarant, a
 * spouse, a child), as the kit's `.avatar`, `.avatar.spouse` and `.avatar.child`.
 */
export type AvatarTone = 'default' | 'brand' | 'info' | 'success';

const TONES: Record<AvatarTone, string> = {
  default: 'bg-avatar text-avatar-foreground',
  brand: 'bg-linear-to-br from-brand/45 to-brand text-primary-foreground',
  info: 'bg-linear-to-br from-info/45 to-info text-primary-foreground',
  success: 'bg-linear-to-br from-success/45 to-success text-primary-foreground',
};

export type AvatarProps = Omit<ComponentProps<'span'>, 'children'> & {
  /** The person's name; the avatar shows its initials. */
  name: string;
  /** The signed-in user: the brand gradient instead of the lilac fill. */
  current?: boolean;
  /** The fill, when the person is not an officer, e.g. a spouse on a declaration. */
  tone?: AvatarTone;
};

/**
 * A person's initials in a 24px circle (resize with `className`): lilac (the `avatar` token)
 * for other people, the brand gradient for the signed-in user. Decorative: always show the name
 * beside it.
 */
export function Avatar({ name, current = false, tone, className, ...props }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      data-current={current || undefined}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full text-[10px] leading-none font-bold',
        TONES[current ? 'brand' : (tone ?? 'default')],
        className,
      )}
      {...props}
    >
      {initials(name)}
    </span>
  );
}
