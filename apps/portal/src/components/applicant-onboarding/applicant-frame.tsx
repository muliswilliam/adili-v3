import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons';
import { Link, useMatches, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { HelpLine, OnboardingStepper } from '../onboarding/onboarding-layout';
import { APPLICANT_FRAME_COPY as COPY } from './copy';
import { APPLICANT_STEP_NAMES } from './steps';

/**
 * What every Get started as an applicant page shares inside the auth shell, as the declarant's
 * `OnboardingFrame`: the Back button and the stepper of the current step (from its route's
 * `staticData`), and the help line. Back to Choose your ID keeps the ID type chosen.
 */
export function ApplicantFrame({ children }: { children: ReactNode }) {
  const step = useMatches({ select: (matches) => matches.at(-1)?.staticData.applicantStep });
  const back = useMatches({ select: (matches) => matches.at(-1)?.staticData.applicantBack });
  const kind = useSearch({ strict: false, select: (search) => search.kind });

  return (
    <>
      {back ? (
        <Button asChild variant="ghost" size="sm" className="-mt-1.5 mb-3.5 -ml-2.5 self-start">
          {back === '/access' ? (
            <Link to="/access">
              <Icon icon={ArrowLeft01Icon} />
              {COPY.back}
            </Link>
          ) : (
            <Link to="/access/get-started" search={{ kind }}>
              <Icon icon={ArrowLeft01Icon} />
              {COPY.back}
            </Link>
          )}
        </Button>
      ) : null}
      {step ? <OnboardingStepper step={step} names={APPLICANT_STEP_NAMES} /> : null}
      {children}
      <HelpLine>{APPLICANT_HELP}</HelpLine>
    </>
  );
}

/** Applicants have no Commission or reporting officer to ask yet. */
export const APPLICANT_HELP = COPY.help;
