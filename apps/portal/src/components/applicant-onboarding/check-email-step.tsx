import { Alert, AlertDescription, Button, Icon, MaskedContact } from '@adili/ui';
import { InformationCircleIcon, LockKeyIcon, Mail01Icon } from '@hugeicons/core-free-icons';
import { useState } from 'react';

import { resendApplicantSetPasswordEmail } from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { RECOVER_ACCESS, SIGN_IN } from '../onboarding/links';
import { StepHeading, SuccessMark } from '../onboarding/onboarding-layout';
import { ResendPasswordEmail } from '../onboarding/outcome-steps';
import { SessionUnavailable } from '../onboarding/step-alerts';
import { CHECK_EMAIL_COPY as COPY, PASSPORT_NOTICE } from './copy';
import type { ApplicantCheckEmailGuard } from './guard';
import { useApplicantSettle } from './settle';

/**
 * Step 5, Check your email: the new account's set-password email, with resend. Without a
 * session it explains how to get a new link.
 */
export function ApplicantCheckEmailStep({ guard }: { guard: ApplicantCheckEmailGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  if (guard.status === 'none') return <NewLinkHelp />;
  return <CheckEmail session={guard.session} />;
}

/**
 * The set-password link can only be sent again from the browser that started, while its
 * session lasts. Anywhere else, Forgot password on the sign-in page sends a link that sets the
 * password just the same.
 */
function NewLinkHelp() {
  return (
    <>
      <SuccessMark tone="brand">
        <Icon icon={LockKeyIcon} strokeWidth={2} />
      </SuccessMark>
      <StepHeading title={COPY.newLinkTitle} description={COPY.newLinkDescription} />
      <div className="mt-[22px] grid gap-2.5">
        <Button asChild className="w-full">
          <a href={RECOVER_ACCESS}>{COPY.forgotPassword}</a>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <a href={SIGN_IN}>{COPY.signIn}</a>
        </Button>
      </div>
    </>
  );
}

function CheckEmail({ session: loaded }: { session: ApplicantOnboardingSession }) {
  // A resend answers with the session, which then says the email went.
  const [session, setSession] = useState(loaded);
  const settle = useApplicantSettle({
    route: '/access/get-started/check-email',
    kind: session.identityDocument.kind,
  });
  const email = session.contacts.email;
  const address = email ? (
    <MaskedContact kind="email" value={email.masked} className="text-foreground" />
  ) : (
    COPY.addressFallback
  );
  return (
    <>
      <SuccessMark tone="brand">
        <Icon icon={Mail01Icon} strokeWidth={2} />
      </SuccessMark>
      {session.setPasswordEmail === 'failed' ? (
        // The account stands; only the email with the link did not go.
        <StepHeading
          title={COPY.failedTitle}
          description={
            <>
              {COPY.failedBefore}
              {address}
              {COPY.failedAfter}
            </>
          }
        />
      ) : (
        <StepHeading
          title={COPY.sentTitle}
          description={
            <>
              {COPY.sentBefore}
              {address}
              {COPY.sentAfter}
            </>
          }
        />
      )}
      {session.identityStatus === 'pending-verification' ? (
        <Alert variant="info" className="mt-[18px]">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{PASSPORT_NOTICE}</AlertDescription>
        </Alert>
      ) : null}
      <div className="mt-[22px] grid gap-2.5">
        <ResendPasswordEmail
          session={session}
          resend={() => resendApplicantSetPasswordEmail()}
          settle={settle}
          onSent={setSession}
        />
        <Button asChild variant="ghost" className="w-full">
          <a href={SIGN_IN}>{COPY.signIn}</a>
        </Button>
      </div>
    </>
  );
}
