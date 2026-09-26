import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  CheckboxItem,
  Icon,
  MaskedContact,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingSession, OtpChannel } from '../../server/directory/types';
import { confirmOnboarding } from '../../server/onboarding';
import type { StepGuard } from './guard';
import { HelpFooter, StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, problemMessage } from './problems';
import { ReadOnlyField } from './read-only-field';
import { SessionUnavailable } from './step-alerts';
import { routeForSession } from './steps';

interface Failure {
  title?: string;
  message: string;
  /** Offers to run the check again; the session waits at this step. */
  retry?: boolean;
}

/**
 * Confirm (#72). The roster's details, read-only; confirming runs the national register check
 * and creates or links the account, and the session's outcome picks the next step.
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
  const navigate = useNavigate();
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const commission = session.commission.name;

  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  async function confirm() {
    if (submitting || !checked) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await confirmOnboarding();
      if (result.ok) {
        await navigate({ to: routeForSession(result.session) });
      } else if (result.code === 'ended') {
        await navigate({ to: '/get-started', search: { ended: true } });
      } else if (result.code === 'moved') {
        // Another tab confirmed first; the loader guard sends this one to the outcome.
        await router.invalidate();
      } else if (result.code === 'iprs-unavailable') {
        setFailure({
          title: 'The national register is not responding',
          message: problemMessage('iprs-unavailable'),
          retry: true,
        });
      } else if (result.code === 'identity-unavailable') {
        setFailure({
          title: 'Your account was not created',
          message: problemMessage('identity-unavailable'),
        });
      } else {
        setFailure({ message: GENERIC_ERROR });
      }
    } catch {
      setFailure({ message: GENERIC_ERROR });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8">
      <StepHeading
        title="Confirm your details"
        description={`Confirm these are your details. They come from ${commission}'s roster and cannot be changed here.`}
      />
      <form
        noValidate
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void confirm();
        }}
        className="grid gap-5"
      >
        {failure ? (
          <Alert ref={alertRef} tabIndex={-1} variant="destructive" className="outline-none">
            <Icon icon={AlertCircleIcon} />
            {failure.title ? <AlertTitle>{failure.title}</AlertTitle> : null}
            <AlertDescription>{failure.message}</AlertDescription>
            {failure.retry ? (
              <Button type="submit" variant="outline" size="sm" className="mt-2 w-fit">
                Try again
              </Button>
            ) : null}
          </Alert>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-2.5 gap-y-4">
          <ReadOnlyField label="Full name" className="col-span-2">
            {details.fullName}
          </ReadOnlyField>
          <ReadOnlyField label="Personnel file number">
            <span className="font-mono">{details.personnelFileNumber}</span>
          </ReadOnlyField>
          <ReadOnlyField label="Designation">{orMissing(details.designation)}</ReadOnlyField>
          <ReadOnlyField label="Reporting entity" className="col-span-2">
            {orMissing(details.reportingEntity)}
          </ReadOnlyField>
          <ReadOnlyField label="Responsible Commission" className="col-span-2">
            {commission}
          </ReadOnlyField>
          <ContactField channel="email" label="Email address" session={session} />
          <ContactField channel="phone" label="Phone number" session={session} />
        </dl>
        <CheckboxItem
          label="I confirm these are my details."
          checked={checked}
          disabled={submitting}
          onChange={(event) => {
            setChecked(event.target.checked);
          }}
        />
        <div className="grid gap-2">
          <Button type="submit" className="w-full" disabled={!checked || submitting}>
            {submitting ? 'Checking the national register…' : 'Confirm and create my account'}
          </Button>
          <p className="text-center text-[13px] text-muted-foreground">
            We will check your name and ID against the national register.
          </p>
        </div>
      </form>
      <HelpFooter>
        Something wrong? Ask your Commission's reporting officer to correct your record.
      </HelpFooter>
    </div>
  );
}

function orMissing(value: string | null) {
  return value ?? <span className="text-muted-foreground">Not on your record</span>;
}

function ContactField({
  channel,
  label,
  session,
}: {
  channel: OtpChannel;
  label: string;
  session: OnboardingSession;
}) {
  const contact = session.contacts[channel];
  return (
    <ReadOnlyField
      label={label}
      className="col-span-2"
      action={contact?.verified ? <Badge variant="success">Verified</Badge> : undefined}
    >
      {contact ? <MaskedContact kind={channel} value={contact.masked} /> : orMissing(null)}
    </ReadOnlyField>
  );
}
