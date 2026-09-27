import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { Icon, type IconProps } from './icon';

export const statusMarkVariants = cva(
  'flex size-14 shrink-0 items-center justify-center rounded-full [&_svg]:size-7',
  {
    variants: {
      tone: {
        success: 'bg-success-subtle text-success-subtle-foreground',
        warning: 'bg-warning-subtle text-warning-subtle-foreground',
        destructive: 'bg-destructive-subtle text-destructive-subtle-foreground',
        neutral: 'bg-muted text-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusMarkTone = NonNullable<VariantProps<typeof statusMarkVariants>['tone']>;

export type StatusMarkProps = Omit<ComponentProps<'div'>, 'children'> & {
  icon: IconProps['icon'];
  tone?: StatusMarkTone;
};

/**
 * A large round state icon above the title of an outcome or error page. Decorative: the title
 * says what happened.
 */
export function StatusMark({ icon, tone, className, ...props }: StatusMarkProps) {
  return (
    <div aria-hidden="true" className={cn(statusMarkVariants({ tone }), className)} {...props}>
      <Icon icon={icon} />
    </div>
  );
}
