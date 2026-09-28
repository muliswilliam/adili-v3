import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon, type IconProps } from './icon';

export type FilterChipProps = Omit<ComponentProps<'button'>, 'onClick' | 'type'> & {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  icon?: IconProps['icon'];
  /** How many items the filter matches, when known. */
  count?: number;
  /** Names the count for screen readers, e.g. "records". */
  countLabel?: string;
};

/**
 * A toggle that narrows a list, such as "Flagged only". Ink when on, a control ring when off;
 * the state is `aria-pressed`.
 */
export function FilterChip({
  pressed,
  onPressedChange,
  icon,
  count,
  countLabel,
  className,
  children,
  ...props
}: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => {
        onPressedChange(!pressed);
      }}
      className={cn(
        focusRing,
        'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[13.5px] font-medium whitespace-nowrap [&_svg]:size-3.5',
        pressed
          ? 'bg-foreground text-background'
          : 'bg-card text-secondary-foreground shadow-control hover:text-foreground',
        className,
      )}
      {...props}
    >
      {icon ? <Icon icon={icon} /> : null}
      {children}
      {count === undefined ? null : (
        <>
          {' '}
          <span className="text-xs tabular-nums opacity-70">
            {count}
            {countLabel ? (
              <>
                {' '}
                <span className="sr-only">{countLabel}</span>
              </>
            ) : null}
          </span>
        </>
      )}
    </button>
  );
}
