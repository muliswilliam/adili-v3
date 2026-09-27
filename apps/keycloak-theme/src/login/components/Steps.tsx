import { cn, Icon } from '@adili/ui';
import { Tick02Icon } from '@hugeicons/core-free-icons';
import type { ReactNode } from 'react';

export interface Step {
  title: ReactNode;
  detail?: ReactNode;
  done?: boolean;
  /** Content under the step, e.g. a QR code or an input. */
  children?: ReactNode;
}

/** Numbered steps in a bordered box. */
export function Steps({ steps, label }: { steps: Step[]; label?: string }) {
  return (
    <ol aria-label={label} className="grid gap-4 rounded-xl bg-muted/60 p-4 sm:p-5">
      {steps.map((step, index) => (
        <li key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
          <span
            className={cn(
              'grid size-7 place-items-center rounded-full text-xs font-semibold',
              step.done
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-secondary-foreground shadow-card',
            )}
            aria-hidden="true"
          >
            {step.done ? (
              <Icon icon={Tick02Icon} className="size-3.5" strokeWidth={2.5} />
            ) : (
              index + 1
            )}
          </span>
          <div className="grid gap-0.5 pt-1">
            <span className="text-sm leading-5 font-medium">{step.title}</span>
            {step.detail ? (
              <span className="text-sm leading-5 text-muted-foreground">{step.detail}</span>
            ) : null}
            {step.children ? <div className="mt-3">{step.children}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
