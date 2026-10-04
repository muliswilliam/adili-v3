import { cn } from '../lib/cn';
import { Badge, type BadgeProps } from './badge';
import { Icon, type IconProps } from './icon';

/** How one status of a contract's status enum looks as a badge. */
export interface StatusBadgeLook {
  variant: NonNullable<BadgeProps['variant']>;
  icon: IconProps['icon'];
  strokeWidth?: number;
}

export type KeyedStatusBadgeProps<S extends string> = Omit<BadgeProps, 'children' | 'variant'> & {
  status: S;
  looks: Record<S, StatusBadgeLook>;
  words: Record<S, string>;
};

/**
 * The shape every badge keyed by a contract status shares (`IntakeStatusBadge`,
 * `ReleaseStatusBadge`): the status's tone, a decorative icon and its word, with
 * `data-status`. Never colour alone.
 */
export function KeyedStatusBadge<S extends string>({
  status,
  looks,
  words,
  className,
  ...props
}: KeyedStatusBadgeProps<S>) {
  const { variant, icon, strokeWidth } = looks[status];
  return (
    <Badge variant={variant} data-status={status} className={cn('pl-[7px]', className)} {...props}>
      <Icon icon={icon} strokeWidth={strokeWidth} />
      {words[status]}
    </Badge>
  );
}
