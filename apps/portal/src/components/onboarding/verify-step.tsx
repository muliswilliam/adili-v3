import {
  Alert,
  AlertDescription,
  Button,
  FormField,
  Icon,
  Input,
  MaskedContact,
  OtpInput,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { type Ref, type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingSession, OtpChannel } from '../../server/directory/types';
import {
  leaveOnboarding,
  provideOnboardingContact,
  resendOnboardingCode,
  verifyOnboardingCode,
} from '../../server/onboarding';
import type { StepProblem, StepResult } from '../../server/onboarding.server';
import { CONTACT_ERRORS, contactError } from './contact';
import { countdownAnnouncement, formatClock, secondsUntil, useCountdown } from './countdown';
import type { StepGuard } from './guard';
import { HelpFooter, StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, problemMessage } from './problems';
import { SessionUnavailable } from './step-pending';
import { routeForSession, type StepRoute } from './steps';

const COPY = {
  email: {
    title: 'Verify your email',
    sentBy: '',
    fallback: 'your email address',
    notYours:
      "Not your email address? Ask your Commission's reporting officer to update your record.",
    verified: 'Email verified',
    addTitle: 'Add your email address',
    addDescription:
      "Your Commission's record has no email address for you. Enter one you can open now and we'll send a code to it.",
    label: 'Email address',
    hint: undefined,
    addFooter: 'Once you verify it, this address is added to your record.',
  },
  phone: {
    title: 'Verify your phone',
    sentBy: 'by SMS ',
    fallback: 'your phone',
    notYours: "Not your number? Ask your Commission's reporting officer to update your record.",
    verified: 'Phone verified',
    addTitle: 'Add your mobile number',
    addDescription:
      "Your Commission's record has no mobile number for you. Enter one that can receive SMS and we'll send a code to it.",
    label: 'Mobile number',
    hint: 'For example 0712 345 678 or +254 712 345 678.',
    addFooter: 'Once you verify it, this number is added to your record.',
  },
} as const;

/** Handles a step's result: moves on, starts again or hands back a problem to show. */
type Settle = (result: StepResult, verified?: string) => Promise<StepProblem | null>;

/**
 * Verify email and Verify phone (#69). The session decides the view: the declarant enters a
 * contact when the roster record has none, otherwise the code sent to it.
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
  const { toast } = useToast();
  const [session, setSession] = useState(initial);

  const settle: Settle = async (result, verified) => {
    if (result.ok) {
      const target = routeForSession(result.session);
      if (target === route) {
        setSession(result.session);
        return null;
      }
      if (verified) toast({ title: verified });
      await navigate({ to: target });
      return null;
    }
    if (result.code === 'ended') {
      await navigate({ to: '/get-started', search: { ended: true } });
      return null;
    }
    if (result.code === 'moved') {
      // Another tab moved the session on; the loader guard sends this one after it.
      await router.invalidate();
      return null;
    }
    return result;
  };

  if (session.state === `${channel}-contact-required`) {
    return <ContactForm channel={channel} settle={settle} />;
  }
  return <CodeForm channel={channel} session={session} onResent={setSession} settle={settle} />;
}

function CodeForm({
  channel,
  session,
  onResent,
  settle,
}: {
  channel: OtpChannel;
  session: OnboardingSession;
  onResent: (session: OnboardingSession) => void;
  settle: Settle;
}) {
  const copy = COPY[channel];
  const contact = session.contacts[channel];
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  // Remounts the boxes after a wrong code, which clears them and puts focus back in the first.
  const [round, setRound] = useState(0);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failed) alertRef.current?.focus();
  }, [failed]);

  function clear() {
    setCode('');
    setRound((current) => current + 1);
  }

  async function verify(value: string) {
    if (verifying || value.length !== 6) return;
    setVerifying(true);
    setFailed(false);
    try {
      const failure = await settle(
        await verifyOnboardingCode({ data: { channel, code: value } }),
        copy.verified,
      );
      if (failure?.code === 'otp-invalid') {
        setError(problemMessage('otp-invalid', { attemptsLeft: failure.attemptsLeft }));
        clear();
      } else if (failure?.code === 'otp-expired') {
        setError(problemMessage('otp-expired'));
        clear();
      } else if (failure) {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="grid gap-8">
      <StepHeading
        title={copy.title}
        description={
          <>
            Enter the 6-digit code we sent {copy.sentBy}to{' '}
            {contact ? (
              <MaskedContact kind={channel} value={contact.masked} className="text-foreground" />
            ) : (
              copy.fallback
            )}
            .
          </>
        }
      />
      <form
        noValidate
        onSubmit={(event: SubmitEvent<HTMLFormElement>) => {
          event.preventDefault();
          void verify(code);
        }}
        className="grid gap-5"
      >
        {failed ? <FailureAlert ref={alertRef} /> : null}
        <OtpInput
          key={round}
          label="Verification code"
          hint="The code expires 10 minutes after we send it."
          error={error}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
          }}
          onComplete={(value) => void verify(value)}
          autoFocus
          disabled={verifying}
          // Spreads the boxes across the column so they line up with the button below.
          className="[&>div]:justify-between"
        />
        <Button type="submit" className="w-full" disabled={verifying || code.length < 6}>
          {verifying ? 'Checking…' : 'Verify'}
        </Button>
        <ResendCode
          channel={channel}
          session={session}
          settle={settle}
          onResent={(next) => {
            onResent(next);
            setError(null);
            clear();
          }}
        />
      </form>
      <HelpFooter>{copy.notYours}</HelpFooter>
    </div>
  );
}

function describeWait(seconds: number): string {
  if (seconds === 0) return 'You can ask for a new code now.';
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `You can ask for a new code in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  return `You can ask for a new code in ${String(seconds)} seconds.`;
}

/**
 * The resend line under the code. The clock ticks every second on screen, but screen readers
 * hear it only at coarse steps, so the countdown does not talk over the declarant.
 */
function ResendCode({
  channel,
  session,
  settle,
  onResent,
}: {
  channel: OtpChannel;
  session: OnboardingSession;
  settle: Settle;
  onResent: (session: OnboardingSession) => void;
}) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [secondsLeft, startCountdown] = useCountdown(secondsUntil(session.otp.resendAvailableAt));
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(secondsLeft);

  useEffect(() => {
    const message = countdownAnnouncement(previous.current, secondsLeft, describeWait);
    // A new countdown clears the last announcement rather than leaving it stale.
    if (secondsLeft > previous.current) setAnnouncement('');
    previous.current = secondsLeft;
    if (message) setAnnouncement(message);
  }, [secondsLeft]);

  function failed() {
    toast({
      title: 'We could not send a new code',
      description: GENERIC_ERROR,
      urgency: 'assertive',
    });
  }

  async function resend() {
    if (sending) return;
    setSending(true);
    try {
      const result = await resendOnboardingCode({ data: { channel } });
      if (result.ok) {
        onResent(result.session);
        startCountdown(secondsUntil(result.session.otp.resendAvailableAt));
        toast({ title: 'New code sent', description: 'Codes we sent earlier no longer work.' });
      } else if (result.code === 'resend-cooldown') {
        startCountdown(result.retryAfterSeconds ?? 60);
      } else if (await settle(result)) {
        failed();
      }
    } catch {
      failed();
    } finally {
      setSending(false);
    }
  }

  async function startAgain() {
    await leaveOnboarding();
    await navigate({ to: '/get-started' });
  }

  let line;
  if (session.otp.resendsLeft <= 0) {
    line = (
      <>
        You cannot ask for more codes. If this one has not arrived,{' '}
        <Button type="button" variant="link" onClick={() => void startAgain()}>
          start again
        </Button>
        .
      </>
    );
  } else if (secondsLeft > 0) {
    line = (
      <>
        Didn't get it? You can ask for a new code in{' '}
        <span className="text-foreground tabular-nums">{formatClock(secondsLeft)}</span>.
      </>
    );
  } else {
    line = (
      <>
        Didn't get it?{' '}
        <Button type="button" variant="link" disabled={sending} onClick={() => void resend()}>
          {sending ? 'Sending…' : 'Send a new code'}
        </Button>
      </>
    );
  }

  return (
    <div className="text-center text-sm text-muted-foreground">
      {/* The first tick can differ between server and browser by a second. */}
      <p suppressHydrationWarning>{line}</p>
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
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failed) alertRef.current?.focus();
  }, [failed]);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const fieldError = contactError(channel, value);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    setSending(true);
    setFailed(false);
    try {
      const failure = await settle(await provideOnboardingContact({ data: { channel, value } }));
      if (failure?.code === 'invalid') setError(CONTACT_ERRORS[channel]);
      else if (failure) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-8">
      <StepHeading title={copy.addTitle} description={copy.addDescription} />
      <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-5">
        {failed ? <FailureAlert ref={alertRef} /> : null}
        <FormField label={copy.label} hint={copy.hint} error={error}>
          <Input
            name={channel}
            type={channel === 'email' ? 'email' : 'tel'}
            inputMode={channel === 'email' ? 'email' : 'tel'}
            autoComplete={channel === 'email' ? 'email' : 'tel'}
            spellCheck={false}
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError(null);
            }}
          />
        </FormField>
        <Button type="submit" className="w-full" disabled={sending}>
          {sending ? 'Sending…' : 'Send code'}
        </Button>
      </form>
      <HelpFooter>{copy.addFooter}</HelpFooter>
    </div>
  );
}

function FailureAlert({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <Alert ref={ref} tabIndex={-1} variant="destructive" className="outline-none">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{GENERIC_ERROR}</AlertDescription>
    </Alert>
  );
}
