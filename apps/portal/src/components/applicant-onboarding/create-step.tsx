import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  COUNTRIES,
  DescriptionItem,
  DescriptionList,
  Icon,
  MaskedContact,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  InformationCircleIcon,
  Tick02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { type Ref, useEffect, useRef, useState } from 'react';

import { completeApplicantOnboarding } from '../../server/applicant-onboarding';
import type { ApplicantOnboardingSession } from '../../server/directory/types';
import { SIGN_IN } from '../onboarding/links';
import { StepHeading } from '../onboarding/onboarding-layout';
import { GENERIC_ERROR, problemMessage } from '../onboarding/problems';
import { SessionUnavailable, StepFailureAlert } from '../onboarding/step-alerts';
import { applicantProblemMessage, CREATE_COPY as COPY, PASSPORT_NOTICE } from './copy';
import type { ApplicantStepGuard } from './guard';
import { useApplicantSettle, useApplicantStartAgain } from './settle';

/** Why creating the account failed. */
type Failure = 'identity-unavailable' | 'email-in-use' | 'already-onboarded' | 'unavailable';

/** The country's name for an ISO 3166-1 alpha-2 code, or the code when it is not listed. */
export function countryName(code: string): string {
  return COUNTRIES.find((country) => country.code === code)?.name ?? code;
}

/**
 * Step 4, Create your account: what the account will be created with, then the account and its
 * set-password email. A passport holder is told the Commission verifies them later.
 */
export function CreateStep({ guard }: { guard: ApplicantStepGuard }) {
  if (guard.status === 'unavailable') return <SessionUnavailable />;
  return <CreateAccount session={guard.session} />;
}

function CreateAccount({ session }: { session: ApplicantOnboardingSession }) {
  const { identityDocument: document, contacts } = session;
  const passport = document.kind === 'passport';
  const settle = useApplicantSettle({ route: '/access/get-started/create', kind: document.kind });
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (failure) alertRef.current?.focus();
  }, [failure]);

  async function create() {
    if (submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      // A completed session moves on to Check your email; if another tab completed it first,
      // the loader guard sends this one after it.
      const problem = await settle(await completeApplicantOnboarding());
      if (
        problem?.code === 'identity-unavailable' ||
        problem?.code === 'email-in-use' ||
        problem?.code === 'already-onboarded'
      ) {
        setFailure(problem.code);
      } else if (problem) {
        setFailure('unavailable');
      }
    } catch {
      setFailure('unavailable');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepHeading title={COPY.title} />
      <div className="mt-5 rounded-2xl bg-card px-[18px] py-4 shadow-card">
        <DescriptionList>
          <DescriptionItem term={COPY.name}>{session.fullName}</DescriptionItem>
          <DescriptionItem term={passport ? COPY.passport : COPY.nationalId}>
            <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
              <span>
                <span className="font-mono">{document.number}</span>
                {passport && document.country ? ` · ${countryName(document.country)}` : null}
              </span>
              {passport ? null : (
                <Badge variant="success">
                  <Icon icon={Tick02Icon} strokeWidth={2.5} />
                  {COPY.matchesRegister}
                </Badge>
              )}
            </span>
          </DescriptionItem>
          <DescriptionItem term={COPY.phone}>
            {contacts.phone ? (
              <MaskedContact
                kind="phone"
                value={contacts.phone.masked}
                verified={contacts.phone.verified}
                className="justify-end gap-1.5"
              />
            ) : null}
          </DescriptionItem>
          <DescriptionItem term={COPY.email}>
            {contacts.email ? (
              <MaskedContact kind="email" value={contacts.email.masked} className="justify-end" />
            ) : null}
          </DescriptionItem>
        </DescriptionList>
      </div>
      {passport ? (
        <Alert variant="info" className="mt-4">
          <Icon icon={InformationCircleIcon} />
          <AlertDescription>{PASSPORT_NOTICE}</AlertDescription>
        </Alert>
      ) : null}
      {failure ? (
        <CreateFailureAlert ref={alertRef} failure={failure} kind={document.kind} />
      ) : null}
      <Button
        type="button"
        className="mt-5 w-full"
        disabled={submitting}
        onClick={() => void create()}
      >
        {submitting ? (
          <>
            <Spinner />
            {COPY.creating}
          </>
        ) : (
          COPY.create
        )}
      </Button>
    </>
  );
}

function CreateFailureAlert({
  ref,
  failure,
  kind,
}: {
  ref: Ref<HTMLDivElement>;
  failure: Failure;
  kind: ApplicantOnboardingSession['identityDocument']['kind'];
}) {
  const startAgain = useApplicantStartAgain(kind);
  const shared = { ref, tabIndex: -1, className: 'mt-4 outline-none' };

  if (failure === 'already-onboarded') {
    return (
      <Alert {...shared} variant="info">
        <Icon icon={UserCheck01Icon} />
        <AlertTitle>{applicantProblemMessage('already-onboarded')}</AlertTitle>
        <Button asChild size="sm" className="mt-2.5 w-fit">
          <a href={SIGN_IN}>{COPY.signIn}</a>
        </Button>
      </Alert>
    );
  }

  if (failure === 'email-in-use') {
    return (
      <Alert {...shared} variant="destructive">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{applicantProblemMessage('email-in-use')}</AlertDescription>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void startAgain(undefined, '/access/get-started/details')}
          >
            {COPY.changeDetails}
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href={SIGN_IN}>{COPY.signIn}</a>
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <StepFailureAlert
      ref={ref}
      className="mt-4"
      message={failure === 'unavailable' ? GENERIC_ERROR : problemMessage(failure)}
    />
  );
}
