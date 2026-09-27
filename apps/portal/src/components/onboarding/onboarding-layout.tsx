import { Button, cn, Icon } from '@adili/ui';
import { ArrowLeft01Icon, HelpCircleIcon } from '@hugeicons/core-free-icons';
import { Link, useMatches, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { STEP_COUNT, STEP_NAMES, type StepNumber } from './steps';

/**
 * What every Get started page shares inside the auth shell: the Back button and stepper of the
 * current step (from its route's `staticData`), and the help line. The stepper stays mounted
 * between steps, so screen readers hear "Step 3 of 6: Verify your email" as the step changes.
 */
export function OnboardingFrame({ children }: { children: ReactNode }) {
  const step = useMatches({ select: (matches) => matches.at(-1)?.staticData.onboardingStep });
  const back = useMatches({ select: (matches) => matches.at(-1)?.staticData.onboardingBack });
  // The Commission picked on step 1 comes back preselected.
  const commission = useSearch({ strict: false, select: (search) => search.commission });

  return (
    <>
      {back ? (
        <Button asChild variant="ghost" size="sm" className="-mt-1.5 mb-3.5 -ml-2.5 self-start">
          <Link to="/get-started" search={{ commission }}>
            <Icon icon={ArrowLeft01Icon} />
            Back
          </Link>
        </Button>
      ) : null}
      {step ? <OnboardingStepper step={step} /> : null}
      {children}
      <HelpLine />
    </>
  );
}

/** Six segments: done steps ink, the current one half ink (the kit's `.stepper`). */
export function OnboardingStepper({ step }: { step: StepNumber }) {
  return (
    <div className="mb-[26px]">
      <div aria-hidden="true" className="mb-2 flex gap-1.5">
        {STEP_NAMES.map((name, index) => (
          <span
            key={name}
            data-state={index + 1 < step ? 'done' : index + 1 === step ? 'current' : undefined}
            className={cn(
              'h-1 flex-1 rounded-full bg-border data-[state=done]:bg-foreground',
              'data-[state=current]:bg-[linear-gradient(90deg,var(--foreground)_50%,var(--border)_50%)]',
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="text-[13px] font-medium text-muted-foreground">
        Step {step} of {STEP_COUNT}
        <span className="sr-only">: {STEP_NAMES[step - 1]}</span>
      </p>
    </div>
  );
}

export function HelpLine() {
  return (
    <p className="mt-7 flex items-start gap-2 border-t pt-4 text-[13.5px] text-muted-foreground">
      <Icon icon={HelpCircleIcon} className="mt-0.5" />
      Need help? Ask your reporting officer.
    </p>
  );
}

/** Heading block for a step: one h1 per page. */
export function StepHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div>
      <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-pretty">
        {title}
      </h1>
      {description ? <p className="mt-2 text-pretty text-muted-foreground">{description}</p> : null}
    </div>
  );
}

/** The round mark above an outcome: a green tick by default, or a brand tint. */
export function SuccessMark({
  tone = 'success',
  children,
}: {
  tone?: 'success' | 'brand';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'mb-5 grid size-16 place-items-center rounded-full [&_svg]:size-[30px]',
        tone === 'success'
          ? 'bg-success-subtle text-success'
          : 'bg-brand-subtle text-brand-subtle-foreground',
      )}
    >
      {children}
    </div>
  );
}
