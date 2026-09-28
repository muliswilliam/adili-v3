import { Cancel01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useEffect } from 'react';

import { cn } from '../lib/cn';
import { focusRing } from '../lib/focus';
import { Icon } from './icon';

export interface StepperStep {
  id: string;
  label: ReactNode;
}

export type StepperProps = Omit<ComponentProps<'nav'>, 'children' | 'onSelect'> & {
  /** Names the navigation landmark, e.g. "Import steps". */
  label: string;
  steps: StepperStep[];
  /**
   * Id of the step the user is on. An id that matches no step shows every step as upcoming
   * and, in development, logs a warning.
   */
  current: string;
  /** Marks the current step as failed, e.g. an import that stopped. */
  failed?: boolean;
  /**
   * Called when the user picks an earlier step. Leave unset, or return false from
   * `canSelect`, to keep a step non-interactive.
   */
  onSelect?: (id: string) => void;
  /** Whether a completed step can be revisited. Defaults to every completed step when onSelect is set. */
  canSelect?: (id: string) => boolean;
};

/**
 * Shows where the user is in a multi-step flow. The current step carries aria-current="step".
 * Completed steps can be buttons back to that step; future and locked steps are plain text,
 * so they never take focus. On phones only the current step's label is shown.
 */
export function Stepper({
  label,
  steps,
  current,
  failed = false,
  onSelect,
  canSelect,
  className,
  ...props
}: StepperProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  useEffect(() => {
    if (import.meta.env.DEV && currentIndex === -1) {
      console.warn(`Stepper: current "${current}" matches none of the step ids.`);
    }
  }, [current, currentIndex]);

  return (
    <nav aria-label={label} className={className} {...props}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'upcoming';
          const selectable =
            state === 'complete' && onSelect !== undefined && (canSelect?.(step.id) ?? true);
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  state === 'complete' && 'bg-success-subtle text-success',
                  state === 'current' &&
                    (failed
                      ? 'bg-destructive text-destructive-foreground'
                      : 'bg-primary text-primary-foreground'),
                  state === 'upcoming' && 'inset-ring-[1.5px] inset-ring-input',
                )}
              >
                {state === 'complete' ? (
                  <Icon icon={Tick02Icon} strokeWidth={2.5} className="size-3.5" />
                ) : state === 'current' && failed ? (
                  <Icon icon={Cancel01Icon} strokeWidth={2.5} className="size-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  state !== 'current' && 'max-sm:sr-only',
                  selectable && 'underline-offset-3 group-hover:underline',
                )}
              >
                {step.label}
              </span>
              {state === 'complete' ? <span className="sr-only"> (completed)</span> : null}
              {state === 'current' && failed ? <span className="sr-only"> (failed)</span> : null}
            </>
          );

          return (
            <li
              key={step.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 text-[13.5px] font-medium',
                state === 'current' && 'text-foreground',
                state === 'complete' &&
                  (selectable ? 'text-secondary-foreground' : 'text-muted-foreground'),
                state === 'upcoming' && 'text-placeholder',
              )}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="h-[1.5px] w-3.5 bg-input sm:w-7" />
              ) : null}
              {selectable ? (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(step.id);
                  }}
                  className={cn(
                    focusRing,
                    'group flex items-center gap-2 rounded-md py-0.5 pr-1 pl-0.5',
                  )}
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2 py-0.5 pr-1 pl-0.5">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
