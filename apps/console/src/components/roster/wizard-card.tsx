import { Card, cn } from '@adili/ui';
import type { ComponentProps } from 'react';

/** One wizard step's card (the prototype's `.wiz-card`): sections, then a footer of actions. */
export function WizardCard({ className, ...props }: ComponentProps<'div'>) {
  return <Card className={cn('mt-5 gap-0 p-0 sm:p-0', className)} {...props} />;
}

/** A padded block of a wizard card. */
export function WizardSection({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5 sm:p-6', className)} {...props} />;
}

/** The id of the current step's heading, which takes focus when the step changes. */
export const WIZARD_TITLE_ID = 'wizard-step-title';

/** The step's heading. */
export function WizardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2
      id={WIZARD_TITLE_ID}
      tabIndex={-1}
      className={cn(
        'text-lg leading-snug font-semibold tracking-[-0.01em] outline-none',
        className,
      )}
      {...props}
    />
  );
}

/** Back and next actions under a hairline (the prototype's `.wiz-foot`). */
export function WizardFoot({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2.5 border-t px-5 py-4 sm:px-6', className)}
      {...props}
    />
  );
}
