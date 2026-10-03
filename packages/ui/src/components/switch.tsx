import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';

export type SwitchProps = Omit<ComponentProps<'button'>, 'onClick' | 'children' | 'role'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Shown beside the track; names the switch. */
  label: ReactNode;
};

/**
 * An on/off control that acts at once (the kit's `.switch`), e.g. "Compare with version 1": a
 * button with `role="switch"`, so keyboard and screen readers get its state. For a choice
 * submitted with a form, use a Checkbox.
 */
export function Switch({ checked, onCheckedChange, label, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onCheckedChange(!checked);
      }}
      className={cn(
        focusRing,
        'group inline-flex cursor-pointer items-center gap-[9px] rounded-md px-0.5 py-1 text-sm font-medium text-foreground select-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="relative h-[22px] w-9 flex-none rounded-full bg-input transition-colors group-aria-checked:bg-primary"
      >
        <span className="absolute top-[3px] left-[3px] size-4 rounded-full bg-card shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[left] group-aria-checked:left-[17px]" />
      </span>
      {label}
    </button>
  );
}
