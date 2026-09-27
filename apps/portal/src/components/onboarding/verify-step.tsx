import { Button, FormField, Input, MaskedContact, OtpInput, useToast } from '@adili/ui';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingSession, OtpChannel } from '../../server/directory/types';
import {
  leaveOnboarding,
  provideOnboardingContact,
  resendOnboardingCode,
  verifyOnboardingCode,
} from '../../server/onboarding';
import type { StepProblem, StepResult } from '../../server/onboarding.server';
import { CONTACT_ERRORS, contactError } from './contact';
import { countdownAnnouncement, secondsUntil, useCountdown } from './countdown';
import type { StepGuard } from './guard';
import { Spinner, StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, problemMessage, SEND_FAILED } from './problems';
import { FailureAlert, SessionUnavailable } from './step-alerts';
import { routeForSession, type StepRoute } from './steps';

const COPY = {
  email: {
    title: 'Verify your email',
    sentTo: 'We sent a 6-digit code to',
    fallback: 'your email address',
    notYours: 'Not your email? Ask your reporting officer.',
    noContact: 'No email on file. Enter one to get your code.',
    label: 'Email address',
    placeholder: 'name@example.com',
  },
  phone: {
    title: 'Verify your phone',
    sentTo: 'We sent a 6-digit code by SMS to',
    fallback: 'your phone',
    notYours: 'Not your phone? Ask your reporting officer.',
    noContact: 'No mobile number on file. Enter one to get your code.',
    label: 'Mobile number',
    placeholder: '0712 345 678',
  },
} as const;

/** The contract's limit on new codes per channel; "resends left" shows once one is used. */
const MAX_RESENDS = 3;

/** Handles a step's result: moves on, starts again or hands back a problem to show. */
type Settle = (result: StepResult) => Promise<StepProblem | null>;

/** Forgets the session in this browser and goes back to step 1, optionally saying why. */
type StartAgain = (notice?: 'too-many') => Promise<void>;

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
  return <VerifyChannel channel={channel} route={route} initial={guard.session} />;
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
  const navigate = useNavigate();
  const router = useRouter();
  const [session, setSession] = useState(initial);
  // Step 1 keeps the Commission chosen when the declarant has to start again.
  const commission = session.commission.slug;

  const settle: Settle = async (result) => {
    if (result.ok) {
      const target = routeForSession(result.session);
      if (target === route) {
        setSession(result.session);
        return null;
      }
      await navigate({ to: target });
      return null;
    }
    if (result.code === 'ended' || result.code === 'too-many') {
      await navigate({
        to: '/get-started',
        search: { commission, notice: result.code === 'ended' ? 'ended' : 'too-many' },
      });
      return null;
    }
    if (result.code === 'moved') {
      // Another tab moved the session on; the loader guard sends this one after it.
      await router.invalidate();
      return null;
    }
    return result;
  };

  const startAgain: StartAgain = async (notice) => {
    await leaveOnboarding();
    await navigate({ to: '/get-started', search: { commission, notice } });
  };

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
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const attemptsLeft = useRef(session.otp.attemptsLeft);
  // Remounts the boxes after a failed code, which clears them and puts focus back in the first.
  const [round, setRound] = useState(0);

  function clear() {
    setCode('');
    setRound((current) => current + 1);
  }

  // The code goes as soon as its sixth digit is in; there is no Verify button.
  async function verify(value: string) {
    if (verifying || value.length !== 6) return;
    setVerifying(true);
    setError(null);
    let failure: StepProblem | null;
    try {
      const result = await verifyOnboardingCode({ data: { channel, code: value } });
      // A directory that ends the session on the last wrong code answers 410, which cannot say
      // why; the attempts count can.
      const lastAttempt = !result.ok && result.code === 'ended' && attemptsLeft.current <= 1;
      failure = await settle(lastAttempt ? { ok: false, code: 'too-many' } : result);
    } catch {
      failure = { code: 'unavailable' };
    }
    setVerifying(false);
    if (!failure) return;
    if (failure.code === 'otp-invalid') {
      if (failure.attemptsLeft !== undefined) attemptsLeft.current = failure.attemptsLeft;
      setError(problemMessage('otp-invalid', { attemptsLeft: failure.attemptsLeft }));
    } else if (failure.code === 'otp-expired') {
      setError(problemMessage('otp-expired'));
    } else {
      setError(GENERIC_ERROR);
    }
    clear();
  }

  return (
    <>
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
      <div className="mt-6 grid gap-2.5">
        <OtpInput
          key={round}
          label="6-digit code"
          error={error}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={(value) => void verify(value)}
          autoFocus
          disabled={verifying}
        />
        {/* Always mounted, so screen readers announce the busy state when it appears. */}
        <p aria-live="polite" className="text-[13.5px] text-muted-foreground empty:hidden">
          {verifying ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-3.5 text-foreground" />
              Checking the code…
            </span>
          ) : null}
        </p>
        <ResendCode
          channel={channel}
          session={session}
          settle={settle}
          startAgain={startAgain}
          onResent={(next) => {
            onResent(next);
            attemptsLeft.current = next.otp.attemptsLeft;
            setError(null);
            clear();
          }}
        />
      </div>
      <p className="mt-[18px] text-[13.5px] text-muted-foreground">
        {contact?.source === 'declarant' ? (
          <>
            Typed it wrong?{' '}
            <Button type="button" variant="link" onClick={() => void startAgain()}>
              Start again
            </Button>
            .
          </>
        ) : (
          copy.notYours
        )}
      </p>
    </>
  );
}

function describeWait(seconds: number): string {
  if (seconds === 0) return 'You can ask for a new code now.';
  return `You can ask for a new code in ${String(seconds)} seconds.`;
}

/**
 * The resend line under the code. The wait ticks every second on screen, but screen readers
 * hear it only at coarse steps, so the countdown does not talk over the declarant.
 */
function ResendCode({
  channel,
  session,
  settle,
  startAgain,
  onResent,
}: {
  channel: OtpChannel;
  session: OnboardingSession;
  settle: Settle;
  startAgain: StartAgain;
  onResent: (session: OnboardingSession) => void;
}) {
  const { toast } = useToast();
  const [secondsLeft, startCountdown] = useCountdown(secondsUntil(session.otp.resendAvailableAt));
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(secondsLeft);
  const { resendsLeft } = session.otp;

  useEffect(() => {
    const message = countdownAnnouncement(previous.current, secondsLeft, describeWait);
    // A new countdown clears the last announcement rather than leaving it stale.
    if (secondsLeft > previous.current) setAnnouncement('');
    previous.current = secondsLeft;
    if (message) setAnnouncement(message);
  }, [secondsLeft]);

  function failed(message: string) {
    toast({ title: message, urgency: 'assertive' });
  }

  async function resend() {
    if (sending) return;
    // One more code would end the session in the directory, so say why rather than ask for it.
    if (resendsLeft <= 0) {
      await startAgain('too-many');
      return;
    }
    setSending(true);
    try {
      const result = await resendOnboardingCode({ data: { channel } });
      if (result.ok) {
        onResent(result.session);
        startCountdown(secondsUntil(result.session.otp.resendAvailableAt));
        toast({ title: 'New code sent' });
      } else if (result.code === 'resend-cooldown') {
        startCountdown(result.retryAfterSeconds ?? 60);
      } else {
        const failure = await settle(result);
        if (failure) failed(failure.code === 'send-failed' ? SEND_FAILED : GENERIC_ERROR);
      }
    } catch {
      failed(GENERIC_ERROR);
    } finally {
      setSending(false);
    }
  }

  const waiting = secondsLeft > 0;
  return (
    <div className="text-sm">
      <Button
        type="button"
        variant="link"
        disabled={waiting || sending}
        onClick={() => void resend()}
        className="tabular-nums disabled:text-muted-foreground disabled:no-underline disabled:opacity-100"
        // The first tick can differ between server and browser by a second.
        suppressHydrationWarning
      >
        {sending ? 'Sending…' : waiting ? `Resend in ${String(secondsLeft)}s` : 'Resend code'}
      </Button>
      {resendsLeft < MAX_RESENDS ? (
        <span className="text-[13.5px] text-muted-foreground">
          {' · '}
          {resendsLeft === 0
            ? 'no more resends'
            : `${String(resendsLeft)} ${resendsLeft === 1 ? 'resend' : 'resends'} left`}
        </span>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
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
        {failure ? <FailureAlert ref={alertRef} message={failure} /> : null}
        <FormField label={copy.label} error={error}>
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
