import {
  Alert,
  AlertDescription,
  Button,
  CheckboxItem,
  DescriptionItem,
  DescriptionList,
  Icon,
  MaskedContact,
  Spinner,
} from '@adili/ui';
import { Clock01Icon } from '@hugeicons/core-free-icons';
import { type Ref, type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingSession, OtpChannel } from '../../server/directory/types';
import { confirmOnboarding } from '../../server/onboarding';
import type { StepGuard } from './guard';
import { StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, problemMessage } from './problems';
import { useSettle } from './settle';
import { SessionUnavailable, StepFailureAlert } from './step-alerts';

/** Why confirming failed. The register being down is a wait; the rest are errors. */
type Failure = 'iprs-unavailable' | 'identity-unavailable' | 'unavailable';

/**
 * Step 5, Confirm your details. The roster's details, read-only; confirming runs the national
 * register check and creates or links the account, and the session's outcome picks the next step.
 */
export function ConfirmStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable' || !guard.session.details) return <SessionUnavailable />;
  return <ConfirmDetails session={guard.session} details={guard.session.details} />;
}

function ConfirmDetails({
  session,
  details,
}: {
  session: OnboardingSession;
  details: NonNullable<OnboardingSession['details']>;
}) {
  const settle = useSettle({ route: '/get-started/confirm', commission: session.commission.slug });
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  async function confirm() {
    if (submitting || !checked) return;
    setSubmitting(true);
    setFailure(null);
    try {
      // A confirmed session moves on to its outcome; if another tab confirmed first, the
      // loader guard sends this one after it.
      const problem = await settle(await confirmOnboarding());
      if (problem?.code === 'iprs-unavailable' || problem?.code === 'identity-unavailable') {
        setFailure(problem.code);
      } else if (problem) {
        setFailure('unavailable');
      }
    } catch {
      setFailure('unavailable');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepHeading
        title="Confirm your details"
        description="From your Commission's roster. You cannot change them here."
      />
      <form
        noValidate
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void confirm();
        }}
        className="contents"
      >
        <div className="mt-[18px] rounded-2xl bg-card px-[18px] py-4 shadow-card">
          <DescriptionList>
            <DescriptionItem term="Full name">{details.fullName}</DescriptionItem>
            <DescriptionItem term="Personnel file number">
              <span className="font-mono">{details.personnelFileNumber}</span>
            </DescriptionItem>
            <DescriptionItem term="Designation">{orMissing(details.designation)}</DescriptionItem>
            <DescriptionItem term="Reporting entity">
              {orMissing(details.reportingEntity)}
            </DescriptionItem>
            <DescriptionItem term="Responsible Commission">
              {session.commission.name}
            </DescriptionItem>
            <ContactItem channel="email" term="Email" session={session} />
            <ContactItem channel="phone" term="Phone" session={session} />
          </DescriptionList>
        </div>
        {failure ? <ConfirmFailureAlert ref={alertRef} failure={failure} /> : null}
        <CheckboxItem
          label="I confirm these are my details."
          checked={checked}
          disabled={submitting}
          className="mt-[18px]"
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
        />
        <Button type="submit" className="mt-[18px] w-full" disabled={!checked || submitting}>
          {submitting ? (
            <>
              <Spinner />
              Checking the national register…
            </>
          ) : (
            'Confirm and create my account'
          )}
        </Button>
        <p className="mt-2.5 text-center text-[13.5px] text-muted-foreground">
          Checked against the national register.
        </p>
      </form>
    </>
  );
}

/** Why confirming failed: the register being down is a wait, with a retry; the rest are errors. */
function ConfirmFailureAlert({ ref, failure }: { ref: Ref<HTMLDivElement>; failure: Failure }) {
  if (failure === 'iprs-unavailable') {
    // A wait, not a mistake: the session is kept and the same check can run again.
    return (
      <Alert ref={ref} tabIndex={-1} className="mt-4 outline-none" variant="warning">
        <Icon icon={Clock01Icon} />
        <AlertDescription>{problemMessage('iprs-unavailable')}</AlertDescription>
        <Button type="submit" variant="secondary" size="sm" className="mt-2.5 w-fit">
          Try again
        </Button>
      </Alert>
    );
  }
  return (
    <StepFailureAlert
      ref={ref}
      className="mt-4"
      message={
        failure === 'identity-unavailable' ? problemMessage('identity-unavailable') : GENERIC_ERROR
      }
    />
  );
}

function orMissing(value: string | null) {
  return value ?? <span className="font-normal text-muted-foreground">Not on your record</span>;
}

function ContactItem({
  channel,
  term,
  session,
}: {
  channel: OtpChannel;
  term: string;
  session: OnboardingSession;
}) {
  const contact = session.contacts[channel];
  return (
    <DescriptionItem term={term}>
      {contact ? (
        <MaskedContact
          kind={channel}
          value={contact.masked}
          verified={contact.verified}
          className="justify-end gap-1.5"
        />
      ) : (
        orMissing(null)
      )}
    </DescriptionItem>
  );
}
