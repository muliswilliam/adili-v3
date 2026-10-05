import { Button, CheckmarkCircleIcon, cn, Icon } from '@adili/ui';
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
    <div className="min-[1000px]:grid min-[1000px]:grid-cols-[minmax(0,1fr)_420px_minmax(0,1fr)] min-[1000px]:gap-8">
      {step ? (
        <aside className="min-[1000px]:col-start-1 min-[1000px]:row-start-1 min-[1000px]:pt-20">
          <OnboardingStepper step={step} />
        </aside>
      ) : null}
      <div className="flex min-w-0 flex-col min-[1000px]:col-start-2 min-[1000px]:row-start-1">
        {step || back ? (
          <div className={cn('mb-3.5 h-8 shrink-0', !back && 'hidden min-[700px]:block')}>
            {back ? (
              <Button asChild variant="ghost" size="sm" className="-ml-2.5">
                <Link to="/get-started" search={{ commission }}>
                  <Icon icon={ArrowLeft01Icon} />
                  Back
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
        {children}
        <HelpLine commissionName={commissionName} />
      </div>
    </div>
  );
}

/** Compact progress bars on mobile, and a labelled vertical list on desktop. */
export function OnboardingStepper({
  step,
  names = STEP_NAMES,
}: {
  step: number;
  names?: readonly string[];
}) {
  return (
    <nav aria-label="Onboarding progress" className="mb-8">
      <div aria-hidden="true" className="mb-2 flex gap-1.5 min-[1000px]:hidden">
        {names.map((name, index) => (
          <span
            key={name}
            data-state={index + 1 < step ? 'done' : index + 1 === step ? 'current' : undefined}
            className="h-1 flex-1 rounded-full bg-border data-[state=done]:bg-foreground data-[state=current]:bg-[linear-gradient(90deg,var(--foreground)_50%,var(--border)_50%)]"
          />
        ))}
      </div>
      <p
        aria-live="polite"
        className="text-[13px] font-medium text-muted-foreground min-[1000px]:sr-only"
      >
        Step {step} of {names.length}
        <span className="sr-only">: {names[step - 1]}</span>
      </p>
      <ol className="hidden gap-3 min-[1000px]:grid">
        {names.map((name, index) => {
          const done = index + 1 < step;
          const current = index + 1 === step;
          return (
            <li
              key={name}
              aria-current={current ? 'step' : undefined}
              className={cn(
                'flex items-center gap-3 text-sm',
                current ? 'text-foreground' : 'text-muted-foreground',
                !done && !current && 'opacity-60',
              )}
            >
              {done ? (
                <CheckmarkCircleIcon className="size-5 text-green-500" />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-5 shrink-0 place-items-center rounded-full border border-dashed border-current text-xs"
                >
                  {index + 1}
                </span>
              )}
              <span>{name}</span>
              {done ? <span className="sr-only">Completed</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
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
