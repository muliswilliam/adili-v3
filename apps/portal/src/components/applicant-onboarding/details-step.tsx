import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  CountrySelect,
  formatClock,
  FormField,
  Icon,
  Input,
  Spinner,
  useCountdown,
} from '@adili/ui';
import { AlertCircleIcon, Clock01Icon, UserCheck01Icon } from '@hugeicons/core-free-icons';
import { useNavigate } from '@tanstack/react-router';
import { type Ref, type SubmitEvent, useEffect, useRef, useState } from 'react';

import { startApplicantOnboarding } from '../../server/applicant-onboarding';
import type { StartProblem } from '../../server/applicant-onboarding.server';
import type { IdentityDocumentKind } from '../../server/directory/types';
import { optionalLabel } from '../declaration/optional-label';
import { RECOVER_ACCESS, SIGN_IN } from '../onboarding/links';
import { StepHeading } from '../onboarding/onboarding-layout';
import { GENERIC_ERROR, problemMessage, SEND_FAILED } from '../onboarding/problems';
import { applicantProblemMessage } from './copy';
import {
  DETAILS_FIELDS,
  type DetailsField,
  type DetailsFieldErrors,
  type DetailsInput,
  detailsErrors,
  refusedFieldMessage,
} from './details';

/** The control id of a field, for focusing the first one to fix. */
const fieldId = (field: DetailsField) => `applicant-${field}`;

function focusField(field: DetailsField | undefined) {
  if (field) document.getElementById(fieldId(field))?.focus();
}

const EMPTY = {
  surname: '',
  firstName: '',
  otherNames: '',
  number: '',
  country: '',
  phone: '',
  email: '',
} satisfies Omit<DetailsInput, 'kind'>;

/**
 * Step 2, Your details: names, the document, a mobile for the code and the email the account
 * is created with. Continue checks a national ID with the national register before any code
 * goes out; a passport is not checked here.
 */
export function DetailsStep({ kind }: { kind: IdentityDocumentKind }) {
  const navigate = useNavigate();
  const passport = kind === 'passport';
  const [values, setValues] = useState<Omit<DetailsInput, 'kind'>>(EMPTY);
  const [errors, setErrors] = useState<DetailsFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [secondsLeft, startCountdown] = useCountdown();
  const problemRef = useRef<HTMLDivElement>(null);

  const blocked = secondsLeft > 0;
  // The rate-limit message goes once the wait is over.
  const shownProblem = problem?.code === 'rate-limit-exceeded' && !blocked ? null : problem;

  // Move focus to a failure so screen reader and keyboard users land on it.
  useEffect(() => {
    if (problem && problem.code !== 'invalid') problemRef.current?.focus();
  }, [problem]);

  function update(field: DetailsField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function showFieldErrors(fieldErrors: DetailsFieldErrors) {
    setErrors(fieldErrors);
    focusField(DETAILS_FIELDS.find((field) => fieldErrors[field]));
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || blocked) return;
    const input: DetailsInput = { kind, ...values, country: passport ? values.country : '' };
    const fieldErrors = detailsErrors(input);
    if (fieldErrors) {
      showFieldErrors(fieldErrors);
      return;
    }
    setSubmitting(true);
    setProblem(null);
    try {
      const result = await startApplicantOnboarding({ data: input });
      if (result.ok) {
        await navigate({ to: result.route });
        return;
      }
      if (result.code === 'invalid' && result.fields.length > 0) {
        // The directory refused fields the browser let through: show them as field errors.
        showFieldErrors(
          Object.fromEntries(
            result.fields.map((field) => [field, refusedFieldMessage(kind, field)]),
          ),
        );
        return;
      }
      setProblem(result);
      if (result.code === 'rate-limit-exceeded') startCountdown(result.retryAfterSeconds ?? 60);
    } catch {
      setProblem({ code: 'unavailable' });
    } finally {
      setSubmitting(false);
    }
  }

  const text = (field: DetailsField) => ({
    id: fieldId(field),
    name: field,
    readOnly: submitting,
    value: values[field],
    onChange: (event: { target: { value: string } }) => {
      update(field, event.target.value);
    },
  });

  return (
    <>
      <StepHeading title="Your details" />
      {shownProblem ? <ProblemAlert ref={problemRef} problem={shownProblem} /> : null}
      {/* POST, so the particulars never land in the address bar if it is sent before hydration. */}
      <form
        noValidate
        method="post"
        onSubmit={(event) => void submit(event)}
        className="mt-[22px] grid gap-4"
      >
        <div className="grid gap-4 min-[520px]:grid-cols-2">
          <FormField label="Surname" error={errors.surname}>
            <Input {...text('surname')} autoComplete="family-name" maxLength={100} />
          </FormField>
          <FormField label="First name" error={errors.firstName}>
            <Input {...text('firstName')} autoComplete="given-name" maxLength={100} />
          </FormField>
        </div>
        <FormField label={optionalLabel('Other names')} error={errors.otherNames}>
          <Input {...text('otherNames')} autoComplete="additional-name" maxLength={100} />
        </FormField>
        {passport ? (
          <div className="grid gap-4 min-[520px]:grid-cols-2">
            <FormField label="Passport number" error={errors.number}>
              <Input
                {...text('number')}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
              />
            </FormField>
            <FormField
              label="Issuing country"
              error={errors.country}
              controlId={fieldId('country')}
            >
              <CountrySelect
                id={fieldId('country')}
                name="country"
                placeholder="Choose"
                disabled={submitting}
                value={values.country || null}
                onValueChange={(code) => {
                  update('country', code ?? '');
                }}
              />
            </FormField>
          </div>
        ) : (
          <FormField label="National ID number" error={errors.number}>
            <Input {...text('number')} inputMode="numeric" autoComplete="off" maxLength={12} />
          </FormField>
        )}
        <FormField label="Mobile number" hint="We send a code by SMS." error={errors.phone}>
          <Input
            {...text('phone')}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={passport ? '+233 24 471 8265' : '0712 345 678'}
            maxLength={30}
          />
        </FormField>
        <FormField label="Email address" hint="Your password link goes here." error={errors.email}>
          <Input
            {...text('email')}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="name@example.com"
            maxLength={254}
          />
        </FormField>
        <Button type="submit" className="mt-1.5 w-full" disabled={submitting || blocked}>
          {submitting ? (
            <>
              <Spinner />
              {passport ? 'Sending code…' : 'Checking the national register…'}
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

function ProblemAlert({ ref, problem }: { ref: Ref<HTMLDivElement>; problem: StartProblem }) {
  const shared = { ref, tabIndex: -1, className: 'mt-[18px] outline-none' };

  if (problem.code === 'already-onboarded') {
    return (
      <Alert {...shared} variant="info">
        <Icon icon={UserCheck01Icon} />
        <AlertTitle>{applicantProblemMessage('already-onboarded')}</AlertTitle>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={problem.links?.signIn ?? SIGN_IN}>Sign in</a>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={problem.links?.recoverAccess ?? RECOVER_ACCESS}>Recover access</a>
          </Button>
        </div>
      </Alert>
    );
  }

  if (problem.code === 'rate-limit-exceeded' || problem.code === 'iprs-unavailable') {
    return (
      <Alert {...shared} variant="warning">
        <Icon icon={Clock01Icon} />
        <AlertDescription>
          {problem.code === 'rate-limit-exceeded'
            ? problemMessage('rate-limit-exceeded', {
                retryAfterSeconds: problem.retryAfterSeconds,
              })
            : problemMessage('iprs-unavailable')}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert {...shared} variant="destructive">
      <Icon icon={AlertCircleIcon} />
      <AlertDescription>
        {problem.code === 'identity-mismatch'
          ? applicantProblemMessage('identity-mismatch')
          : problem.code === 'send-failed'
            ? SEND_FAILED
            : GENERIC_ERROR}
      </AlertDescription>
    </Alert>
  );
}
