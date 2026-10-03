import { type ComponentProps, type ReactNode, useId } from 'react';

import { cn } from '../lib/cn';

export type SwitchProps = Omit<ComponentProps<'input'>, 'type' | 'role' | 'onChange'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** What the switch turns on, e.g. "Published"; its accessible name whatever the state. */
  label: string;
  /** Shown beside the track; the label by default. Use it to say the state, e.g. "Not published". */
  text?: ReactNode;
  /** A line under the text, e.g. who can see the article; describes the switch. */
  hint?: ReactNode;
};

/**
 * An on/off setting that takes effect with the form (the kit's `.switch`): a native checkbox
 * with `role="switch"`, a 40x24px track that fills success when on, the text and an optional
 * hint beside it. Named by `label` so the name stays put while the text says the state.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  text,
  hint,
  id,
  disabled,
  className,
  ...props
}: SwitchProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex items-start gap-3',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input
        {...props}
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        aria-describedby={hintId}
        className="peer sr-only"
        onChange={(event) => {
          onCheckedChange(event.target.checked);
        }}
      />
      <span
        aria-hidden="true"
        className="relative mt-px h-6 w-10 flex-none rounded-full bg-input transition-colors peer-checked:bg-success peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid after:absolute after:top-[3px] after:left-[3px] after:size-[18px] after:rounded-full after:bg-card after:shadow-control after:transition-transform peer-checked:after:translate-x-4 motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      <span>
        <span className="text-[14.5px] font-medium">{text ?? label}</span>
        {hint ? (
          <span id={hintId} className="mt-0.5 block text-[13px] text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
