import { Tick02Icon } from '@hugeicons/core-free-icons';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { Icon } from './icon';

export interface StepperStep {
  id: string;
  label: ReactNode;
}

export type StepperProps = Omit<ComponentProps<'nav'>, 'children'> & {
  /** Names the navigation landmark, e.g. "Import steps". */
  label: string;
  steps: StepperStep[];
  /** Id of the step the user is on. */
  current: string;
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
 * Completed steps can be buttons back to that step; future and disabled steps are plain text,
 * so they never take focus.
 */
export function Stepper({
  label,
  steps,
  current,
  onSelect,
  canSelect,
  className,
  ...props
}: StepperProps) {
  const currentIndex = steps.findIndex((step) => step.id === current);

  return (
    <nav aria-label={label} className={className} {...props}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
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
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                  state === 'upcoming'
                    ? 'bg-muted text-muted-foreground'
                    : 'bg-primary text-primary-foreground',
                )}
              >
                {state === 'complete' ? <Icon icon={Tick02Icon} className="size-3.5" /> : index + 1}
              </span>
              <span className={cn(state === 'current' && 'font-medium')}>{step.label}</span>
              {state === 'complete' ? <span className="sr-only"> (completed)</span> : null}
            </>
          );

          return (
            <li
              key={step.id}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm',
                state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {index > 0 ? <span aria-hidden="true" className="h-px w-6 bg-border" /> : null}
              {selectable ? (
                <button
                  type="button"
                  onClick={() => {
                    onSelect(step.id);
                  }}
                  className="flex items-center gap-2 rounded-lg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
