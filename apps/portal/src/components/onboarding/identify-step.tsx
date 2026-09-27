import { Alert, AlertDescription, AlertTitle, Button, FormField, Icon, Input } from '@adili/ui';
import { AlertCircleIcon, Clock01Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import { type Ref, type SubmitEvent, useEffect, useRef, useState } from 'react';

import type { OnboardingCommission } from '../../server/directory/types';
import { identifyDeclarant } from '../../server/onboarding';
import type { IdentifyProblem } from '../../server/onboarding.server';
import { CommissionChip } from './commission-picker';
import { formatClock, useCountdown } from './countdown';
import { type IdentifyFieldErrors, identifyErrors } from './identify';
import { Spinner, StepHeading } from './onboarding-layout';
import { GENERIC_ERROR, problemMessage } from './problems';

/**
 * Step 2, Identify yourself: the personnel file number and national ID, matched against the
 * chosen Commission's roster.
 */
export function IdentifyStep({ commission }: { commission: OnboardingCommission }) {
  const navigate = useNavigate();
  const [values, setValues] = useState({ personnelFileNumber: '', nationalId: '' });
  const [errors, setErrors] = useState<IdentifyFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<IdentifyProblem | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const fileNumberRef = useRef<HTMLInputElement>(null);
  const nationalIdRef = useRef<HTMLInputElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);

  const blocked = secondsLeft > 0;
  // The rate-limit message goes once the wait is over.
  const shownProblem = problem?.code === 'rate-limited' && !blocked ? null : problem;

  // Move focus to a failure so screen reader and keyboard users land on it.
  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  function update(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || blocked) return;
    const input = { commission: commission.slug, ...values };
    const fieldErrors = identifyErrors(input);
    if (fieldErrors) {
      setErrors(fieldErrors);
      // The first field to fix, in the order they appear.
      (fieldErrors.personnelFileNumber ? fileNumberRef : nationalIdRef).current?.focus();
      return;
    }
    setSubmitting(true);
    setProblem(null);
    try {
      const result = await identifyDeclarant({ data: input });
      if (result.ok) {
        await navigate({ to: result.route });
        return;
      }
      setProblem(result);
      if (result.code === 'rate-limited') {
        startCountdown(result.retryAfterSeconds ?? 60);
      }
    } catch {
      setProblem({ code: 'unavailable' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepHeading title="Identify yourself" />
      <div className="mt-3">
        <CommissionChip commission={commission} />
      </div>
      {shownProblem ? (
        <ProblemAlert ref={problemRef} problem={shownProblem} commissionName={commission.name} />
      ) : null}
      {/* POST, so the numbers never land in the address bar if it is sent before hydration. */}
      <form
        noValidate
        method="post"
        onSubmit={(event) => void submit(event)}
        className="mt-[22px] grid gap-4"
      >
        <FormField
          label="Personnel file number"
          hint="As it appears on your payslip."
          error={errors.personnelFileNumber}
        >
          <Input
            ref={fileNumberRef}
            name="personnelFileNumber"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            readOnly={submitting}
            value={values.personnelFileNumber}
            onChange={(event) => {
              update('personnelFileNumber', event.target.value);
            }}
          />
        </FormField>
        <FormField label="National ID number" error={errors.nationalId}>
          <Input
            ref={nationalIdRef}
            name="nationalId"
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            readOnly={submitting}
            value={values.nationalId}
            onChange={(event) => {
              update('nationalId', event.target.value);
            }}
          />
        </FormField>
        <Button type="submit" className="mt-1.5 w-full" disabled={submitting || blocked}>
          {submitting ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : blocked ? (
            <>
              <Icon icon={Clock01Icon} />
              {/* The alert states the wait once; the button counts down without announcing. */}
              <span className="tabular-nums">Try again in {formatClock(secondsLeft)}</span>
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </form>
    </>
  );
}

function ProblemAlert({
  ref,
  problem,
  commissionName,
}: {
  ref: Ref<HTMLDivElement>;
  problem: IdentifyProblem;
  commissionName: string;
}) {
  const shared = { ref, tabIndex: -1, className: 'mt-[18px] outline-none' };

  if (problem.code === 'already-onboarded') {
    return (
      <Alert {...shared} variant="info">
        <Icon icon={UserCheck01Icon} />
        <AlertTitle>{problemMessage('already-onboarded')}</AlertTitle>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={problem.links?.signIn ?? '/auth/login'}>Sign in</a>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={problem.links?.recoverAccess ?? '/auth/login'}>Recover access</a>
          </Button>
        </div>
      </Alert>
    );
  }

  if (problem.code === 'rate-limited' || problem.code === 'no-roster') {
    return (
      <Alert {...shared} variant="warning">
        <Icon icon={problem.code === 'rate-limited' ? Clock01Icon : AlertCircleIcon} />
        <AlertDescription>
          {problemMessage(problem.code, {
            commissionName,
            retryAfterSeconds: problem.retryAfterSeconds,
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert {...shared} variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>
        {problem.code === 'no-match'
          ? problemMessage('no-match', { commissionName })
          : GENERIC_ERROR}
      </AlertDescription>
    </Alert>
  );
}
