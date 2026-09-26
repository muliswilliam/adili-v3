import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Combobox,
  FormField,
  Icon,
  Input,
} from '@adili/ui';
import { AlertCircleIcon, Clock01Icon } from '@hugeicons/core-free-icons';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { type Ref, type SubmitEvent, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

import {
  identifyErrors,
  type IdentifyFieldErrors,
  type IdentifyInput,
} from '../../components/onboarding/identify';
import { HelpFooter, StepHeading } from '../../components/onboarding/onboarding-layout';
import { GENERIC_ERROR, problemMessage } from '../../components/onboarding/problems';
import { routeForSession } from '../../components/onboarding/steps';
import { formatClock, useCountdown } from '../../components/onboarding/countdown';
import type { OnboardingCommission } from '../../server/directory/types';
import {
  getOnboardingCommissions,
  getOnboardingSession,
  identifyDeclarant,
} from '../../server/onboarding';
import type { IdentifyProblem } from '../../server/onboarding.server';

export const Route = createFileRoute('/get-started/')({
  validateSearch: z.object({
    /** Preselects a Commission, e.g. from a link a reporting officer shared. */
    commission: z.string().optional(),
    /** Set when a later step found no live session. */
    ended: z.boolean().optional(),
  }),
  loader: async () => {
    const [lookup, commissions] = await Promise.all([
      getOnboardingSession(),
      getOnboardingCommissions(),
    ]);
    if (lookup.status === 'active') {
      const target = routeForSession(lookup.session);
      if (target !== '/get-started') throw redirect({ to: target });
    }
    return { commissions };
  },
  component: GetStarted,
});

const COMMISSION_HINT =
  'The Commission you declare to, not the school, ministry or department you work in.';

function GetStarted() {
  const { commissions } = Route.useLoaderData();
  const { commission: preselected, ended } = Route.useSearch();

  return (
    <div className="grid gap-8">
      <StepHeading
        title="Find your record"
        description="We match your details to your Commission's roster, so you don't have to fill in everything yourself."
      />
      {ended ? (
        <Alert>
          <Icon icon={Clock01Icon} />
          <AlertDescription>{problemMessage('session-expired')}</AlertDescription>
        </Alert>
      ) : null}
      {commissions ? (
        <IdentifyForm
          commissions={commissions}
          preselected={
            commissions.some((entry) => entry.slug === preselected) ? preselected : undefined
          }
        />
      ) : (
        <CommissionsUnavailable />
      )}
      <HelpFooter />
    </div>
  );
}

function CommissionsUnavailable() {
  const router = useRouter();
  return (
    <Alert variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertTitle>We could not load the list of Commissions</AlertTitle>
      <AlertDescription>{GENERIC_ERROR}</AlertDescription>
      <Button
        variant="outline"
        size="sm"
        className="mt-2 w-fit"
        onClick={() => {
          void router.invalidate();
        }}
      >
        Try again
      </Button>
    </Alert>
  );
}

function IdentifyForm({
  commissions,
  preselected,
}: {
  commissions: OnboardingCommission[];
  preselected?: string;
}) {
  const navigate = useNavigate();
  const [values, setValues] = useState<IdentifyInput>({
    commission: preselected ?? '',
    personnelFileNumber: '',
    nationalId: '',
  });
  const [errors, setErrors] = useState<IdentifyFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<IdentifyProblem | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const problemRef = useRef<HTMLDivElement>(null);

  const selected = commissions.find((entry) => entry.slug === values.commission);
  const noRoster = selected !== undefined && !selected.hasRoster;
  const blocked = secondsLeft > 0;
  // The rate-limit message goes once the wait is over.
  const shownProblem = problem?.code === 'rate-limited' && !blocked ? null : problem;

  // Move focus to a failure so screen reader and keyboard users land on it.
  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  function update(field: keyof IdentifyInput, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || blocked || noRoster) return;
    const fieldErrors = identifyErrors(values);
    if (fieldErrors) {
      setErrors(fieldErrors);
      return;
    }
    setSubmitting(true);
    setProblem(null);
    try {
      const result = await identifyDeclarant({ data: values });
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
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-5">
      {shownProblem ? (
        <ProblemAlert ref={problemRef} problem={shownProblem} commissionName={selected?.name} />
      ) : null}
      <FormField label="Responsible Commission" hint={COMMISSION_HINT} error={errors.commission}>
        <Combobox
          name="commission"
          placeholder="Select your Commission"
          options={commissions.map((entry) => ({
            value: entry.slug,
            label: entry.name,
            description: entry.issuerCode,
          }))}
          value={values.commission === '' ? null : values.commission}
          onValueChange={(value) => {
            update('commission', value ?? '');
            setProblem(null);
          }}
        />
      </FormField>
      {noRoster ? (
        <Alert variant="warning">
          <Icon icon={AlertCircleIcon} />
          <AlertDescription>
            {problemMessage('no-roster', { commissionName: selected.name })}
          </AlertDescription>
        </Alert>
      ) : null}
      <FormField label="Personnel file number" error={errors.personnelFileNumber}>
        <Input
          name="personnelFileNumber"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          value={values.personnelFileNumber}
          onChange={(event) => {
            update('personnelFileNumber', event.target.value);
          }}
        />
      </FormField>
      <FormField label="National ID number" error={errors.nationalId}>
        <Input
          name="nationalId"
          inputMode="numeric"
          autoComplete="off"
          value={values.nationalId}
          onChange={(event) => {
            update('nationalId', event.target.value);
          }}
        />
      </FormField>
      <Button type="submit" className="w-full" disabled={submitting || blocked || noRoster}>
        {submitting
          ? 'Checking…'
          : blocked
            ? `Try again in ${formatClock(secondsLeft)}`
            : 'Continue'}
      </Button>
    </form>
  );
}

function ProblemAlert({
  ref,
  problem,
  commissionName,
}: {
  ref: Ref<HTMLDivElement>;
  problem: IdentifyProblem;
  commissionName?: string;
}) {
  if (problem.code === 'already-onboarded') {
    return (
      <Alert ref={ref} tabIndex={-1} className="outline-none">
        <AlertTitle>{problemMessage('already-onboarded')}</AlertTitle>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={problem.links?.signIn ?? '/auth/login'}>Sign in</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={problem.links?.recoverAccess ?? '/auth/login'}>Recover access</a>
          </Button>
        </div>
      </Alert>
    );
  }

  const message =
    problem.code === 'unavailable' || problem.code === 'invalid'
      ? GENERIC_ERROR
      : // The wait is stated once; the button counts down, so the alert is not re-read.
        problemMessage(problem.code, {
          commissionName,
          retryAfterSeconds: problem.retryAfterSeconds,
        });
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      variant={problem.code === 'rate-limited' ? 'warning' : 'destructive'}
      className="outline-none"
    >
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
