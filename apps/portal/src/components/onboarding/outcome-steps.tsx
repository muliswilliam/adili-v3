import { Alert, Button, CopyButton, Icon, MaskedContact, useToast } from '@adili/ui';
import { AlertCircleIcon, Mail01Icon, SentIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { OnboardingSession } from '../../server/directory/types';
import { leaveOnboarding, resendSetPasswordEmail } from '../../server/onboarding';
import { countdownAnnouncement, secondsUntil, useCountdown } from './countdown';
import type { StepGuard } from './guard';
import { StepHeading, SuccessMark } from './onboarding-layout';
import { GENERIC_ERROR } from './problems';
import { SessionUnavailable } from './step-alerts';

const SIGN_IN = '/auth/login';
/** The directory's wait between set-password emails, if it does not say. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Check your email (step 6): the new account's set-password email, with resend. */
export function CheckEmailStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  return <CheckEmail session={guard.session} />;
}

function CheckEmail({ session }: { session: OnboardingSession }) {
  const email = session.contacts.email;
  return (
    <>
      <SuccessMark tone="brand">
        <Icon icon={Mail01Icon} strokeWidth={2} />
      </SuccessMark>
      <StepHeading
        title="Check your email"
        description={
          <>
            Your account is ready. Set your password with the link sent to{' '}
            {email ? (
              <MaskedContact kind="email" value={email.masked} className="text-foreground" />
            ) : (
              'your email address'
            )}
            . It expires in 24 hours.
          </>
        }
      />
      {session.ofr ? <OfficerReference ofr={session.ofr} /> : null}
      <div className="mt-[22px] grid gap-2.5">
        <ResendEmail session={session} />
        <Button asChild variant="ghost" className="w-full">
          <a href={SIGN_IN}>Sign in</a>
        </Button>
      </div>
    </>
  );
}

function OfficerReference({ ofr }: { ofr: string }) {
  return (
    <>
      <div className="mt-[22px] flex items-center gap-3 rounded-2xl bg-brand-faint px-4 py-3.5 ring-1 ring-brand-subtle-foreground/15">
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-muted-foreground">Officer reference</p>
          <p className="font-mono text-lg font-semibold tracking-[0.02em]">{ofr}</p>
        </div>
        <CopyButton
          value={ofr}
          label="Copy"
          aria-label="Copy officer reference"
          copiedMessage="Officer reference copied"
          showLabel
        />
      </div>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        Quote it when you contact the helpdesk.
      </p>
    </>
  );
}

function describeWait(seconds: number): string {
  if (seconds === 0) return 'You can ask for the email again now.';
  return `You can ask for the email again in ${String(seconds)} seconds.`;
}

/**
 * Sends the set-password email again. The wait ticks every second on screen; screen readers
 * hear it only at coarse steps.
 */
function ResendEmail({ session }: { session: OnboardingSession }) {
  const navigate = useNavigate();
  const router = useRouter();
  const { toast } = useToast();
  const [secondsLeft, startCountdown] = useCountdown(secondsUntil(session.otp.resendAvailableAt));
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const previous = useRef(secondsLeft);

  useEffect(() => {
    const message = countdownAnnouncement(previous.current, secondsLeft, describeWait);
    if (secondsLeft > previous.current) setAnnouncement('');
    previous.current = secondsLeft;
    if (message) setAnnouncement(message);
  }, [secondsLeft]);

  async function resend() {
    if (sending) return;
    setSending(true);
    try {
      const result = await resendSetPasswordEmail();
      if (result.ok) {
        startCountdown(
          secondsUntil(result.session.otp.resendAvailableAt) || RESEND_COOLDOWN_SECONDS,
        );
        toast({ title: 'Email sent again' });
      } else if (result.code === 'resend-cooldown') {
        startCountdown(result.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      } else if (result.code === 'ended') {
        await navigate({ to: '/get-started', search: { notice: 'ended' } });
      } else if (result.code === 'moved') {
        await router.invalidate();
      } else {
        failed();
      }
    } catch {
      failed();
    } finally {
      setSending(false);
    }
  }

  function failed() {
    toast({
      title: 'We could not send the email',
      description: GENERIC_ERROR,
      urgency: 'assertive',
    });
  }

  const waiting = secondsLeft > 0;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={waiting || sending}
        onClick={() => void resend()}
      >
        {waiting ? null : <Icon icon={SentIcon} />}
        {/* The first tick can differ between server and browser by a second. */}
        <span className="tabular-nums" suppressHydrationWarning>
          {sending
            ? 'Sending…'
            : waiting
              ? `Resend email in ${String(secondsLeft)}s`
              : 'Resend email'}
        </span>
      </Button>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

/** Done (step 6): the roster record was linked to the declarant's existing account. */
export function DoneStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  const { session } = guard;
  return (
    <>
      <SuccessMark>
        <Icon icon={Tick02Icon} strokeWidth={2.4} />
      </SuccessMark>
      <StepHeading
        title={`${session.commission.name} added to your account`}
        description={
          session.ofr ? (
            <>
              Sign in to <span className="font-mono text-foreground">{session.ofr}</span> with your
              usual password.
            </>
          ) : (
            'Sign in with your usual password.'
          )
        }
      />
      <Button asChild className="mt-6 w-full">
        <a href={SIGN_IN}>Sign in</a>
      </Button>
    </>
  );
}

/** Not verified: the roster's name or ID does not match the national register. No stepper. */
export function NotVerifiedStep({ guard }: { guard: StepGuard }) {
  const navigate = useNavigate();
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  const { commission } = guard.session;

  async function startAgain() {
    await leaveOnboarding();
    await navigate({ to: '/get-started', search: { commission: commission.slug } });
  }

  return (
    <>
      <Alert variant="destructive" className="p-[18px] [&>svg]:top-[21px] [&>svg]:left-[18px]">
        <Icon icon={AlertCircleIcon} />
        <div>
          <h1 className="text-lg leading-[1.3] font-semibold">We could not verify your identity</h1>
          <p className="mt-1.5">
            The name or ID number on {commission.name}'s roster does not match the national
            register. Your reporting officer has been notified on the roster. Contact them to have
            your record corrected, then start again.
          </p>
        </div>
      </Alert>
      <Button type="button" className="mt-[22px] w-full" onClick={() => void startAgain()}>
        Back to start
      </Button>
    </>
  );
}
