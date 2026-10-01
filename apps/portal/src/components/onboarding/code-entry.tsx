import {
  Button,
  OtpInput,
  secondsUntil,
  Spinner,
  useCountdown,
  useCountdownAnnouncement,
  useToast,
} from '@adili/ui';
import { type ReactNode, useRef, useState } from 'react';

import type { StepProblem, StepResult } from '../../server/onboarding.server';
import { GENERIC_ERROR, problemMessage, SEND_FAILED, type StartAgainNotice } from './problems';

/** The contract's limit on new codes per channel; "resends left" shows once one is used. */
const MAX_RESENDS = 3;

/** The code a session waits for, as both onboarding contracts give it. */
export interface CodeView {
  attemptsLeft: number;
  resendAvailableAt: string | null;
  resendsLeft: number;
}

export interface CodeEntryProps<S> {
  /** The step's heading, saying where the code went. */
  heading: ReactNode;
  /** The code the session waits for when the step opens. */
  code: CodeView;
  /** The code the session waits for after a resend. */
  codeOf: (session: S) => CodeView;
  /** Sends a code to the directory. */
  verify: (code: string) => Promise<StepResult<S>>;
  /** Asks the directory for a new code. */
  resend: () => Promise<StepResult<S>>;
  /** Moves on, starts again or hands back the problem to show (see `settle`). */
  settle: (result: StepResult<S>) => Promise<StepProblem | null>;
  /** Forgets the session in this browser and goes back to the first step. */
  startAgain: (notice?: StartAgainNotice) => Promise<void>;
  /** Takes the session after a resend. */
  onResent: (session: S) => void;
  /** The line under the code, e.g. what to do when the contact is wrong. */
  footer: ReactNode;
}

/**
 * The 6-digit code step of onboarding, a declarant's (Verify your email or phone) or an
 * applicant's (Verify your phone): the code boxes, the busy and failure lines and the resend link.
 * The code goes as soon as its sixth digit is in; there is no Verify button.
 */
export function CodeEntry<S>({
  heading,
  code: initialCode,
  codeOf,
  verify: send,
  resend,
  settle,
  startAgain,
  onResent,
  footer,
}: CodeEntryProps<S>) {
  const [codeView, setCodeView] = useState(initialCode);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  // The last code was never checked (network or directory trouble), so it can be sent again.
  const [canRetry, setCanRetry] = useState(false);
  const attemptsLeft = useRef(initialCode.attemptsLeft);
  // Remounts the boxes after a failed code, which clears them and puts focus back in the first.
  const [round, setRound] = useState(0);

  function clear() {
    setCode('');
    setRound((current) => current + 1);
  }

  async function verify(value: string) {
    if (verifying || value.length !== 6) return;
    setVerifying(true);
    setError(null);
    setCanRetry(false);
    let failure: StepProblem | null;
    try {
      const result = await send(value);
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
      // Only a wrong code clears the boxes (spec 03), ready for the next try.
      if (failure.attemptsLeft !== undefined) attemptsLeft.current = failure.attemptsLeft;
      setError(problemMessage('otp-invalid', { attemptsLeft: failure.attemptsLeft }));
      clear();
    } else if (failure.code === 'otp-expired') {
      setError(problemMessage('otp-expired'));
    } else {
      // The code was never checked, so it stays for a retry: Try again, or pasting it again,
      // sends it again.
      setError(GENERIC_ERROR);
      setCanRetry(true);
    }
  }

  return (
    <>
      {heading}
      <div className="mt-6 grid gap-2.5">
        <OtpInput
          key={round}
          label="6-digit code"
          error={error}
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError(null);
            setCanRetry(false);
          }}
          onComplete={(value) => void verify(value)}
          autoFocus
          disabled={verifying}
        />
        {canRetry && !verifying ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => void verify(code)}
          >
            Try again
          </Button>
        ) : null}
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
          code={codeView}
          codeOf={codeOf}
          resend={resend}
          settle={settle}
          startAgain={startAgain}
          onResent={(session) => {
            const next = codeOf(session);
            setCodeView(next);
            onResent(session);
            attemptsLeft.current = next.attemptsLeft;
            setError(null);
            clear();
          }}
        />
      </div>
      <p className="mt-[18px] text-[13.5px] text-muted-foreground">{footer}</p>
    </>
  );
}

function describeWait(seconds: number): string {
  if (seconds === 0) return 'You can ask for a new code now.';
  return `You can ask for a new code in ${String(seconds)} seconds.`;
}

/**
 * The resend line under the code. The wait ticks every second on screen, but screen readers
 * hear it only at 10-second steps, so the countdown does not talk over the person.
 */
function ResendCode<S>({
  code,
  codeOf,
  resend: send,
  settle,
  startAgain,
  onResent,
}: {
  code: CodeView;
  codeOf: (session: S) => CodeView;
  resend: () => Promise<StepResult<S>>;
  settle: (result: StepResult<S>) => Promise<StepProblem | null>;
  startAgain: (notice?: StartAgainNotice) => Promise<void>;
  onResent: (session: S) => void;
}) {
  const { toast } = useToast();
  const [secondsLeft, startCountdown] = useCountdown(secondsUntil(code.resendAvailableAt));
  const [sending, setSending] = useState(false);
  const announcement = useCountdownAnnouncement(secondsLeft, describeWait);
  const { resendsLeft } = code;

  function failed(message: string) {
    toast({ title: message, urgency: 'assertive' });
  }

  async function resend() {
    if (sending) return;
    // One more code would end the session in the directory, so say why rather than ask for it.
    // Contract gap: the directory has no call to end a session, so this only forgets it in this
    // browser and the directory's copy lapses at its expiry. Flagged on #386.
    if (resendsLeft <= 0) {
      await startAgain('too-many');
      return;
    }
    setSending(true);
    try {
      const result = await send();
      if (result.ok) {
        onResent(result.session);
        startCountdown(secondsUntil(codeOf(result.session).resendAvailableAt));
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
