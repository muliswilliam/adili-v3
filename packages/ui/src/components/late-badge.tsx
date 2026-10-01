import { Clock01Icon } from '@hugeicons/core-free-icons';

import { Badge, type BadgeProps } from './badge';
import { Icon } from './icon';

export type LateBadgeProps = Omit<BadgeProps, 'children' | 'variant'> & {
  /** The wording; "Filed late" by default. */
  label?: string;
};

/**
 * A declaration submitted after its obligation's due date: "Filed late" in amber with a clock,
 * wherever a filed declaration or version is listed. The text says it, never colour alone.
 */
export function LateBadge({ label = 'Filed late', ...props }: LateBadgeProps) {
  return (
    <Badge variant="warning" {...props}>
      <Icon icon={Clock01Icon} />
      {label}
    </Badge>
  );
}
