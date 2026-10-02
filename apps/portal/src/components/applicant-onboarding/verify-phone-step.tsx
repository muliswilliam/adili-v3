import { Button, MaskedContact } from '@adili/ui';
import { useState } from 'react';

import {
  resendApplicantOnboardingCode,
  verifyApplicantOnboardingCode,
} from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { CodeEntry } from '../onboarding/code-entry';
import { StepHeading } from '../onboarding/onboarding-layout';
import { SessionUnavailable } from '../onboarding/step-alerts';
import { VERIFY_PHONE_COPY as COPY } from './copy';
import type { ApplicantStepGuard } from './guard';
import { useApplicantSettle, useApplicantStartAgain } from './settle';

/** Step 3, Verify your phone: the 6-digit code sent by SMS when the applicant started. */
export function VerifyPhoneStep({ guard }: { guard: ApplicantStepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  // A different session from rerun loaders (another tab) starts the step over from it.
  return <VerifyPhone key={JSON.stringify(guard.session)} initial={guard.session} />;
}

function VerifyPhone({ initial }: { initial: ApplicantOnboardingSession }) {
  const [session, setSession] = useState(initial);
  const { kind } = session.identityDocument;
  const settle = useApplicantSettle({
    route: '/access/get-started/verify-phone',
    kind,
    onStay: setSession,
  });
  const startAgain = useApplicantStartAgain(kind);
  const phone = session.contacts.phone;

  return (
    <CodeEntry
      heading={
        <StepHeading
          title={COPY.title}
          description={
            <>
              {COPY.sentBefore}
              {phone ? (
                <MaskedContact kind="phone" value={phone.masked} className="text-foreground" />
              ) : (
                COPY.phoneFallback
              )}
              {COPY.sentAfter}
            </>
          }
        />
      }
      code={session.otp}
      codeOf={(next) => next.otp}
      verify={(code) => verifyApplicantOnboardingCode({ data: { code } })}
      resend={() => resendApplicantOnboardingCode()}
      settle={settle}
      startAgain={(notice) => startAgain(notice)}
      onResent={setSession}
      footer={
        <>
          {COPY.wrongNumber}{' '}
          <Button
            type="button"
            variant="link"
            onClick={() => void startAgain(undefined, '/access/get-started/details')}
          >
            {COPY.changeIt}
          </Button>
        </>
      }
    />
  );
}
