import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import * as SelectPrimitive from '@radix-ui/react-select';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';
import { controlClassName } from './input';

type RootProps = ComponentProps<typeof SelectPrimitive.Root>;

export type SelectProps = Omit<
  ComponentProps<typeof SelectPrimitive.Trigger>,
  'dir' | 'value' | 'defaultValue'
> &
  Pick<
    RootProps,
    | 'value'
    | 'defaultValue'
    | 'onValueChange'
    | 'open'
    | 'defaultOpen'
    | 'onOpenChange'
    | 'name'
    | 'required'
    | 'form'
    | 'autoComplete'
    | 'dir'
  > & {
    placeholder?: ReactNode;
    /** SelectItem elements. */
    children: ReactNode;
  };

/**
 * A single-choice dropdown styled like Input. Other props go to the trigger button, so it
 * works as the control inside a FormField (id, aria-describedby and aria-invalid land on the
 * button the label points at).
 */
export function Select({
  value,
  defaultValue,
  onValueChange,
  open,
  defaultOpen,
  onOpenChange,
  name,
  required,
  form,
  autoComplete,
  dir,
  disabled,
  placeholder,
  className,
  children,
  ...triggerProps
}: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      name={name}
      required={required}
      form={form}
      autoComplete={autoComplete}
      dir={dir}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        className={cn(
          controlClassName,
          'flex h-11 items-center justify-between gap-2 px-3 text-left data-placeholder:text-placeholder [&>span]:truncate',
          className,
        )}
        {...triggerProps}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <Icon icon={ArrowDown01Icon} className="text-muted-foreground" strokeWidth={2} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl bg-card text-card-foreground shadow-pop"
        >
          <SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex h-9 cursor-default items-center rounded-md pr-8 pl-2.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
        <Icon icon={Tick02Icon} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** Options under a heading, e.g. "Flags" and "Items" in one list. */
export function SelectGroup({
  label,
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Group> & { label: ReactNode }) {
  return (
    <SelectPrimitive.Group className={cn('not-first:mt-1.5', className)} {...props}>
      <SelectPrimitive.Label className="px-2.5 pt-1.5 pb-1 text-xs font-semibold text-muted-foreground">
        {label}
      </SelectPrimitive.Label>
      {children}
    </SelectPrimitive.Group>
  );
}
