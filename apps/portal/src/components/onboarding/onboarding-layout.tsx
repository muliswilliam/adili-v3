import { Button, cn, Icon } from '@adili/ui';
import { ArrowLeft01Icon, HelpCircleIcon } from '@hugeicons/core-free-icons';
import { Link, useMatches, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { STEP_NAMES } from './steps';

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
  const commissionName = useMatches({
    select: (matches) => commissionNameFrom(matches.at(-1)?.loaderData, commission),
  });

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
      <HelpLine commissionName={commissionName} />
    </>
  );
}

/**
 * One segment per step (the declarant's six unless `names` says otherwise): done steps ink, the
 * current one half ink (the kit's `.stepper`). The last step is the page the flow ends on (Check
 * your email, Done): nothing is left to do on screen, so every segment reads done there.
 */
export function OnboardingStepper({
  step,
  names = STEP_NAMES,
}: {
  step: number;
  names?: readonly string[];
}) {
  const finished = step >= names.length;
  return (
    <div className="mb-[26px]">
      <div aria-hidden="true" className="mb-2 flex gap-1.5">
        {names.map((name, index) => (
          <span
            key={name}
            data-state={
              finished || index + 1 < step ? 'done' : index + 1 === step ? 'current' : undefined
            }
            className={cn(
              'h-1 flex-1 rounded-full bg-border data-[state=done]:bg-foreground',
              'data-[state=current]:bg-[linear-gradient(90deg,var(--foreground)_50%,var(--border)_50%)]',
            )}
          />
        ))}
      </div>
      <p aria-live="polite" className="text-[13px] font-medium text-muted-foreground">
        Step {step} of {names.length}
        <span className="sr-only">: {names[step - 1]}</span>
      </p>
    </div>
  );
}

/**
 * The Commission the page is about, when its loader knows it: the session's, the one being
 * identified against, or the one chosen on step 1.
 */
export function commissionNameFrom(loaderData: unknown, slug?: string): string | null {
  if (typeof loaderData !== 'object' || loaderData === null) return null;
  const data = loaderData as {
    session?: { commission?: { name?: string } };
    commission?: { name?: string } | null;
    commissions?: { slug: string; name: string }[] | null;
  };
  return (
    data.session?.commission?.name ??
    data.commission?.name ??
    data.commissions?.find((entry) => entry.slug === slug)?.name ??
    null
  );
}

/**
 * Who to ask for help. The contract gives the Commission but not its reporting officer's name,
 * so the Commission is named when known. `children` replaces the line, e.g. for applicants, who
 * have no Commission.
 */
export function HelpLine({
  commissionName,
  children,
}: {
  commissionName?: string | null;
  children?: ReactNode;
}) {
  return (
    <p className="mt-7 flex items-start gap-2 border-t pt-4 text-[13.5px] text-muted-foreground">
      <Icon icon={HelpCircleIcon} className="mt-0.5" />
      {children ??
        (commissionName
          ? `Need help? Contact ${commissionName}'s reporting officer.`
          : "Need help? Contact your Commission's reporting officer.")}
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
