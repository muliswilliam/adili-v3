import {
  Alert,
  Button,
  Icon,
  MaskedContact,
  OfficerReference,
  secondsUntil,
  useCountdown,
  useCountdownAnnouncement,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  LockKeyIcon,
  Mail01Icon,
  SentIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useState } from 'react';

import type { OnboardingSession } from '../../server/directory/types';
import { resendSetPasswordEmail } from '../../server/onboarding';
import type { CheckEmailGuard, StepGuard } from './guard';
import { RECOVER_ACCESS, SIGN_IN } from './links';
import { StepHeading, SuccessMark } from './onboarding-layout';
import { GENERIC_ERROR } from './problems';
import { useSettle, useStartAgain } from './settle';
import { SessionUnavailable } from './step-alerts';

/** The wait between set-password emails (spec 03), when the directory does not give a time. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Seconds until the set-password email can go again. The email has only just been sent when
 * this page shows, so without a time from the directory the full cooldown applies.
 */
function emailWait(resendAvailableAt: string | null): number {
  return resendAvailableAt === null ? RESEND_COOLDOWN_SECONDS : secondsUntil(resendAvailableAt);
}

/**
 * Check your email (step 6): the new account's set-password email, with resend. Without a
 * session (e.g. from an expired link on another device) it explains how to get a new link.
 */
export function CheckEmailStep({ guard }: { guard: CheckEmailGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  if (guard.status === 'none') return <NewLinkHelp />;
  return <CheckEmail session={guard.session} />;
}

/**
 * The set-password link can only be sent again from the browser that onboarded, while its
 * session lasts. Anywhere else, "Forgot password" on the sign-in page sends a link that sets
 * the password just the same (FE-7).
 */
function NewLinkHelp() {
  return (
    <>
      <SuccessMark tone="brand">
        <Icon icon={LockKeyIcon} strokeWidth={2} />
      </SuccessMark>
      <StepHeading
        title="Get a new link to set your password"
        description="We cannot send the email again from this browser. Use Forgot password on the sign-in page instead: enter your email or officer reference and we will email you a new link. It sets your password too."
      />
      <div className="mt-[22px] grid gap-2.5">
        <Button asChild className="w-full">
          <a href={RECOVER_ACCESS}>Forgot password</a>
        </Button>
        <Button asChild variant="ghost" className="w-full">
          <a href={SIGN_IN}>Sign in</a>
        </Button>
      </div>
    </>
  );
}

/** Leaves this finished onboarding so the declarant can onboard with another Commission. */
function StartAnother() {
  const startAgain = useStartAgain();
  return (
    <Button
      type="button"
      variant="link"
      className="justify-self-center"
      onClick={() => void startAgain()}
    >
      Start again for another Commission
    </Button>
  );
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
      {session.ofr ? <OfficerReferencePanel ofr={session.ofr} /> : null}
      <div className="mt-[22px] grid gap-2.5">
        <ResendEmail session={session} />
        <Button asChild variant="ghost" className="w-full">
          <a href={SIGN_IN}>Sign in</a>
        </Button>
        <StartAnother />
      </div>
    </>
  );
}

/** The new officer reference, set apart so the declarant notes it down. */
function OfficerReferencePanel({ ofr }: { ofr: string }) {
  return (
    <>
      <div className="mt-[22px] rounded-2xl bg-brand-faint px-4 py-3.5 ring-1 ring-brand-subtle-foreground/15">
        <p className="text-[13.5px] font-medium text-muted-foreground">Officer reference</p>
        <OfficerReference value={ofr} className="text-lg" />
      </div>
      <p className="mt-2 text-[13.5px] text-muted-foreground">
        Your officer reference. Quote it when you contact the helpdesk.
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
 * hear it only at 10-second steps.
 */
function ResendEmail({ session }: { session: OnboardingSession }) {
  const settle = useSettle({
    route: '/get-started/check-email',
    commission: session.commission.slug,
  });
  const { toast } = useToast();
  const [secondsLeft, startCountdown] = useCountdown(emailWait(session.otp.resendAvailableAt));
  const [sending, setSending] = useState(false);
  const announcement = useCountdownAnnouncement(secondsLeft, describeWait);

  async function resend() {
    if (sending) return;
    setSending(true);
    try {
      const result = await resendSetPasswordEmail();
      if (result.ok) {
        // It has just gone, so there is always a wait, even if the directory's clock says
        // the next one is already allowed.
        startCountdown(emailWait(result.session.otp.resendAvailableAt) || RESEND_COOLDOWN_SECONDS);
        toast({ title: 'Email sent again' });
      } else if (result.code === 'resend-cooldown') {
        startCountdown(result.retryAfterSeconds ?? RESEND_COOLDOWN_SECONDS);
      } else if (await settle(result)) {
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
  return <Done session={guard.session} />;
}

/**
 * The session is kept, so a refresh or Back comes back here while the cookie lasts. It does not
 * hold the declarant: Get started does not resume a finished session (`resumeRoute`), and
 * "Start again for another Commission" forgets it.
 */
function Done({ session }: { session: OnboardingSession }) {
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
      <div className="mt-6 grid gap-2.5">
        <Button asChild className="w-full">
          <a href={SIGN_IN}>Sign in</a>
        </Button>
        <StartAnother />
      </div>
    </>
  );
}

/** Not verified: the roster's name or ID does not match the national register. No stepper. */
export function NotVerifiedStep({ guard }: { guard: StepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  return <NotVerified session={guard.session} />;
}

function NotVerified({ session }: { session: OnboardingSession }) {
  const { commission } = session;
  // Starting again is the declarant's choice here, not a session that ended, so no notice.
  const startAgain = useStartAgain(commission.slug);

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
