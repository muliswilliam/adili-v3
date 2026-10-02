import type { BadgeProps } from '@adili/ui';

import type { Tone } from '../../../clarification/labels';

/** A status tone as a `Badge` variant. */
export const TONE_BADGE: Record<Tone, NonNullable<BadgeProps['variant']>> = {
  neutral: 'default',
  info: 'info',
  brand: 'brand',
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
};
