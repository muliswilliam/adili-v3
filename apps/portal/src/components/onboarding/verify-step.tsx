import { Button, FormField, Input, MaskedContact, Spinner } from '@adili/ui';
import { type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingSession, OtpChannel } from '../../server/directory/types';
import {
  provideOnboardingContact,
  resendOnboardingCode,
  verifyOnboardingCode,
} from '../../server/onboarding';
import { CodeEntry } from './code-entry';
import { CONTACT_ERRORS, contactError } from './contact';
import type { StepGuard } from './guard';
import { StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, SEND_FAILED } from './problems';
import { useSettle, useStartAgain } from './settle';
import { StepFailureAlert, SessionUnavailable } from './step-alerts';
import type { StepRoute } from './steps';

const COPY = {
  email: {
    title: 'Verify your email',
    sentTo: 'We sent a 6-digit code to',
    fallback: 'your email address',
    notYours: 'Not your email? Ask your reporting officer.',
    noContact: 'No email on file. Enter one to get your code.',
    label: 'Email address',
    placeholder: 'name@example.com',
    hint: undefined,
  },
  phone: {
    title: 'Verify your phone',
    sentTo: 'We sent a 6-digit code by SMS to',
    fallback: 'your phone',
    notYours: 'Not your phone? Ask your reporting officer.',
    noContact: 'No mobile number on file. Enter one to get your code.',
    label: 'Mobile number',
    placeholder: '0712 345 678',
    hint: 'Kenyan mobile, e.g. 0712 345 678',
  },
} as const;

/** Handles a step's result: moves on, starts again or hands back a problem to show. */
type Settle = ReturnType<typeof useSettle>;

/** Forgets the session in this browser and goes back to step 1, optionally saying why. */
type StartAgain = ReturnType<typeof useStartAgain>;

/**
 * Verify email and Verify phone (steps 3 and 4). The session decides the view: the declarant
 * enters a contact when the roster record has none, otherwise the code sent to it.
 */
export function VerifyStep({
  channel,
  route,
  guard,
}: {
  channel: OtpChannel;
  route: StepRoute;
  guard: StepGuard;
}) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  // The step keeps the session it is given and updates it as the declarant goes. When the
  // loaders rerun (router.invalidate() after a 409 from another tab) and bring a different
  // session that still belongs on this route, e.g. a contact entered elsewhere, start over from
  // it rather than keep showing the old one.
  return (
    <VerifyChannel
      key={JSON.stringify(guard.session)}
      channel={channel}
      route={route}
      initial={guard.session}
    />
  );
}

function VerifyChannel({
  channel,
  route,
  initial,
}: {
  channel: OtpChannel;
  route: StepRoute;
  initial: OnboardingSession;
}) {
  const [session, setSession] = useState(initial);
  // Step 1 keeps the Commission chosen when the declarant has to start again.
  const commission = session.commission.slug;
  const settle = useSettle({ route, commission, onStay: setSession });
  const startAgain = useStartAgain(commission);

  if (session.state === `${channel}-contact-required`) {
    return <ContactForm channel={channel} settle={settle} />;
  }
  return (
    <CodeForm
      channel={channel}
      session={session}
      onResent={setSession}
      settle={settle}
      startAgain={startAgain}
    />
  );
}

function CodeForm({
  channel,
  session,
  onResent,
  settle,
  startAgain,
}: {
  channel: OtpChannel;
  session: OnboardingSession;
  onResent: (session: OnboardingSession) => void;
  settle: Settle;
  startAgain: StartAgain;
}) {
  const copy = COPY[channel];
  const contact = session.contacts[channel];
  return (
    <CodeEntry
      heading={
        <StepHeading
          title={copy.title}
          description={
            <>
              {copy.sentTo}{' '}
              {contact ? (
                <MaskedContact kind={channel} value={contact.masked} className="text-foreground" />
              ) : (
                copy.fallback
              )}
              .
            </>
          }
        />
      }
      code={session.otp}
      codeOf={(next) => next.otp}
      verify={(code) => verifyOnboardingCode({ data: { channel, code } })}
      resend={() => resendOnboardingCode({ data: { channel } })}
      settle={settle}
      startAgain={startAgain}
      onResent={onResent}
      footer={
        contact?.source === 'declarant' ? (
          <>
            Typed it wrong?{' '}
            <Button type="button" variant="link" onClick={() => void startAgain()}>
              Start again
            </Button>
            .
          </>
        ) : (
          copy.notYours
        )
      }
    />
  );
}

function ContactForm({ channel, settle }: { channel: OtpChannel; settle: Settle }) {
  const copy = COPY[channel];
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const fieldError = contactError(channel, value);
    if (fieldError) {
      setError(fieldError);
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    setFailure(null);
    try {
      const problem = await settle(await provideOnboardingContact({ data: { channel, value } }));
      if (problem?.code === 'invalid') {
        setError(CONTACT_ERRORS[channel]);
        inputRef.current?.focus();
      } else if (problem) {
        setFailure(problem.code === 'send-failed' ? SEND_FAILED : GENERIC_ERROR);
      }
    } catch {
      setFailure(GENERIC_ERROR);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <StepHeading title={copy.title} description={copy.noContact} />
      <form
        noValidate
        method="post"
        onSubmit={(event) => void submit(event)}
        className="mt-[22px] grid gap-4"
      >
        {failure ? <StepFailureAlert ref={alertRef} message={failure} /> : null}
        <FormField label={copy.label} hint={copy.hint} error={error}>
          <Input
            ref={inputRef}
            name={channel}
            type={channel === 'email' ? 'email' : 'tel'}
            inputMode={channel === 'email' ? 'email' : 'tel'}
            autoComplete={channel === 'email' ? 'email' : 'tel'}
            placeholder={copy.placeholder}
            spellCheck={false}
            autoFocus
            readOnly={sending}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />
        </FormField>
        <Button type="submit" className="mt-1.5 w-full" disabled={sending}>
          {sending ? (
            <>
              <Spinner />
              Sending…
            </>
          ) : (
            'Send code'
          )}
        </Button>
      </form>
    </>
  );
}
