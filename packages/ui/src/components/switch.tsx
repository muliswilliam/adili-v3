import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { joinIds } from '../lib/use-field-ids';
import { Tooltip } from './tooltip';

export type SwitchProps = Omit<ComponentProps<'button'>, 'onClick' | 'children' | 'role'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Shown beside the track; names the switch. */
  label: ReactNode;
  /**
   * Why the switch cannot be used now. It stays focusable (`aria-disabled`, not `disabled`) so
   * keyboard and screen reader users reach it and hear the reason as its description; a tooltip
   * shows it too. Clicks do nothing and it reads as off. An empty reason does not block.
   */
  blockedReason?: string;
};

/**
 * An on/off control that acts at once (the kit's `.switch`), e.g. "Compare with version 1": a
 * button with `role="switch"`, so keyboard and screen readers get its state. For a choice
 * submitted with a form, use a Checkbox.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  blockedReason,
  className,
  'aria-describedby': describedBy,
  ...props
}: SwitchProps) {
  const reasonId = useId();
  const blocked = blockedReason !== undefined && blockedReason !== '';
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked && !blocked}
      aria-describedby={joinIds(describedBy, blocked ? reasonId : undefined)}
      {...(blocked ? { 'aria-disabled': true } : {})}
      onClick={() => {
        if (!blocked) onCheckedChange(!checked);
      }}
      className={cn(
        focusRing,
        'group inline-flex cursor-pointer items-center gap-[9px] rounded-md px-0.5 py-1 text-sm font-medium text-foreground select-none disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
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
  if (!blocked) return control;
  return (
    <>
      <Tooltip content={blockedReason}>{control}</Tooltip>
      <span id={reasonId} className="sr-only">
        {blockedReason}
      </span>
    </>
  );
}
