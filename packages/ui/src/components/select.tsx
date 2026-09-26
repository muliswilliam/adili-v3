import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import * as SelectPrimitive from '@radix-ui/react-select';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

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
          'flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border-0 bg-control px-2.5 text-left text-sm shadow-control transition-shadow outline-none hover:shadow-control-hover focus-visible:shadow-control-focus disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:shadow-control-error aria-invalid:focus-visible:shadow-control-error-focus data-placeholder:text-placeholder [&>span]:truncate',
          className,
        )}
        {...triggerProps}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <Icon icon={ArrowDown01Icon} className="text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className="relative z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border bg-card text-card-foreground shadow-md"
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
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
        'relative flex h-8 cursor-default items-center rounded-md pr-8 pl-2 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-secondary-hover',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
        <Icon icon={Tick02Icon} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
