import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps } from 'react';

import { Icon } from './icon';

/** Decorative check circle from the shared free stroke-icon set. */
export function CheckmarkCircleIcon(props: Omit<ComponentProps<typeof Icon>, 'icon'>) {
  return <Icon icon={CheckmarkCircle02Icon} {...props} />;
}
