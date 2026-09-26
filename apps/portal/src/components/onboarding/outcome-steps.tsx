import {
  Alert,
  AlertDescription,
  Button,
  CopyButton,
  Icon,
  MaskedContact,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import type { OnboardingSession } from '../../server/directory/types';
import { leaveOnboarding, resendSetPasswordEmail } from '../../server/onboarding';
import { countdownAnnouncement, formatClock, secondsUntil, useCountdown } from './countdown';
import type { StepGuard } from './guard';
import { HelpFooter, StepHeading } from './onboarding-layout';
import { GENERIC_ERROR } from './problems';
import { ReadOnlyField } from './read-only-field';
import { SessionUnavailable } from './step-alerts';

const SIGN_IN = '/auth/login';
/** The directory's wait between set-password emails, if it does not say. */
const RESEND_COOLDOWN_SECONDS = 60;

/** Check your email (#72): the new account's set-password email, with resend. */
export function CheckEmailStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  return <CheckEmail session={guard.session} />;
}

function CheckEmail({ session }: { session: OnboardingSession }) {
  const email = session.contacts.email;
  return (
    <div className="grid gap-8">
      <StepHeading
        title="Check your email"
        description={
          <>
            Your account is ready. We sent a link to{' '}
            {email ? (
              <MaskedContact kind="email" value={email.masked} className="text-foreground" />
            ) : (
              'your email address'
            )}{' '}
            to set your password. The link is valid for 24 hours.
          </>
        }
      />
      <div className="grid gap-5">
        {session.ofr ? <OfficerReference ofr={session.ofr} /> : null}
        <ResendEmail session={session} />
        <p className="text-center text-sm text-muted-foreground">
          Set your password already?{' '}
          <a
            href={SIGN_IN}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open the sign-in page
          </a>
        </p>
      </div>
      <HelpFooter>The email can take a few minutes. Check your spam folder too.</HelpFooter>
    </div>
  );
}

function OfficerReference({ ofr }: { ofr: string }) {
  return (
    <div className="grid gap-2">
      <dl>
        <ReadOnlyField
          label="Officer reference"
          action={
            <CopyButton
              value={ofr}
              label="Copy officer reference"
              copiedMessage="Officer reference copied"
              size="sm"
              className="-mr-1.5 size-7"
            />
          }
        >
          <span className="font-mono">{ofr}</span>
        </ReadOnlyField>
      </dl>
      <p className="text-[13px] text-muted-foreground">Quote it when you contact the helpdesk.</p>
    </div>
  );
}

function describeWait(seconds: number): string {
  if (seconds === 0) return 'You can ask for the email again now.';
  return `You can ask for the email again in ${String(seconds)} seconds.`;
}

/**
 * Sends the set-password email again. The clock ticks every second on screen; screen readers
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
        await navigate({ to: '/get-started', search: { ended: true } });
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
    <div>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        disabled={waiting || sending}
        onClick={() => void resend()}
      >
        {/* The first tick can differ between server and browser by a second. */}
        <span className="tabular-nums" suppressHydrationWarning>
          {sending
            ? 'Sending…'
            : waiting
              ? `Resend email in ${formatClock(secondsLeft)}`
              : 'Resend email'}
        </span>
      </Button>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** Done (#72): the roster record was linked to the declarant's existing account. */
export function DoneStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  const { session } = guard;
  const account = session.ofr
    ? `your existing Adili account (${session.ofr})`
    : 'your existing Adili account';
  return (
    <div className="grid gap-8">
      <StepHeading
        title="Your account is linked"
        description={`${session.commission.name} has been added to ${account}. Sign in with your usual password.`}
      />
      <Button asChild className="w-full">
        <a href={SIGN_IN}>Sign in</a>
      </Button>
      <HelpFooter />
    </div>
  );
}

/** Not verified (#72): the roster's name or ID does not match the national register. */
export function NotVerifiedStep({ guard }: { guard: StepGuard }) {
  const navigate = useNavigate();
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  const commission = guard.session.commission.name;

  async function startAgain() {
    await leaveOnboarding();
    await navigate({ to: '/get-started' });
  }

  return (
    <div className="grid gap-8">
      <StepHeading title="We could not verify your identity" />
      <Alert variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>
          The name or ID number on {commission}'s roster does not match the national register. Your
          reporting officer has been notified on the roster. Contact them to have your record
          corrected, then start again.
        </AlertDescription>
      </Alert>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => void startAgain()}
      >
        Back to start
      </Button>
      <HelpFooter />
    </div>
  );
}
