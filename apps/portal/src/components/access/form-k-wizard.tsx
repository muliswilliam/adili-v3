import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Icon,
  SectionNav,
  type SectionNavSection,
  Spinner,
} from '@adili/ui';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Clock01Icon,
  SentIcon,
} from '@hugeicons/core-free-icons';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { FORM_K_COPY as COPY, STEPS } from '../../access/copy';
import {
  emptyDraft,
  FORM_K_STEPS,
  type CheckedDraft,
  type FormKDraft,
  type FormKStep,
  formKDraftSchema,
  type StepErrors,
  stepErrors,
} from '../../access/form-k';
import type { Applicant, SubmitResult } from '../../server/access-requests.server';
import type { AccessCommission } from '../../server/access/types';
import type { Unauthenticated } from '../../server/results';
import { signInAgain } from '../sign-in';
import {
  CommissionStep,
  DeclareStep,
  fieldId,
  InformationStep,
  OfficerStep,
  ParticularsStep,
  ScopeStep,
} from './form-k-steps';

export type SubmitFormK = (input: {
  draft: CheckedDraft;
  idempotencyKey: string;
}) => Promise<SubmitResult | Unauthenticated>;

type Failure = 'invalid' | 'unavailable' | 'unauthenticated' | null;

/**
 * The step's own checks, plus a Commission with no declarations yet blocking step 1 (under
 * `commissionYears`: the step says why in its own notice, not on the field).
 */
function errorsOf(step: FormKStep, draft: FormKDraft, commissions: AccessCommission[]) {
  const errors = stepErrors(step, draft);
  if (step === 'commission' && !errors.commission) {
    const chosen = commissions.find((commission) => commission.slug === draft.commission);
    if (chosen?.years.length === 0) errors.commissionYears = COPY.noYears(chosen.name);
  }
  return errors;
}

/** The control to focus for a field at fault. */
function controlFor(path: string): HTMLElement | null {
  if (path === 'commissionYears') return document.getElementById(fieldId('commission'));
  if (path.startsWith('scope.')) {
    return document.querySelector<HTMLElement>('input[name^="form-k-scope"]:not(:disabled)');
  }
  return document.getElementById(fieldId(path));
}

const hasErrors = (errors: StepErrors) => Object.keys(errors).length > 0;

/**
 * Form K in six steps (spec 10 FE-3): the Commission, the applicant's particulars (pre-filled
 * from the account), the officer sought, the information sought and why, the scope, and the
 * declaration of truth over a review of the whole form. Each step checks itself on Continue
 * (the checks mirror `form-k.v1`); the steps can be visited in any order, and submitting checks
 * them all, opening the first that needs attention. A 400 from the service lands on the step
 * at fault.
 */
export function FormKWizard({
  applicant,
  commissions,
  now,
  submit,
  onSubmitted,
  initialStep = 'commission',
  initialDraft,
}: {
  applicant: Applicant;
  commissions: AccessCommission[];
  /** Epoch milliseconds from the server, for the declaration date. */
  now: number;
  submit: SubmitFormK;
  onSubmitted: (request: { id: string; reference: string }) => void;
  initialStep?: FormKStep;
  initialDraft?: FormKDraft;
}) {
  const [draft, setDraft] = useState<FormKDraft>(() => initialDraft ?? emptyDraft());
  const [step, setStep] = useState<FormKStep>(initialStep);
  /** Steps the applicant tried to leave: their errors show from then on, as they type. */
  const [checked, setChecked] = useState<ReadonlySet<FormKStep>>(new Set());
  /** Fields the service refused, until the applicant edits them. */
  const [refused, setRefused] = useState<StepErrors>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);
  /** One key per body: a retry of the same form replays, an edited form is a new request. */
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const commission = commissions.find((each) => each.slug === draft.commission);
  const index = FORM_K_STEPS.indexOf(step);

  const errors: StepErrors = {
    ...(checked.has(step) ? errorsOf(step, draft, commissions) : {}),
    ...refused,
  };

  useEffect(() => {
    // Move focus to the new step's heading, not on first render.
    if (!moved.current) return;
    heading.current?.focus();
  }, [step]);

  function update(change: (current: FormKDraft) => FormKDraft) {
    const next = change(draft);
    setDraft(next);
    // A refused field the applicant changes is theirs to check again.
    setRefused((was) =>
      Object.fromEntries(
        Object.entries(was).filter(([path]) => valueAt(next, path) === valueAt(draft, path)),
      ),
    );
    if (failure === 'unavailable') setFailure(null);
  }

  function go(target: FormKStep) {
    moved.current = true;
    setStep(target);
    window.scrollTo({ top: 0 });
  }

  function focusFirstError(found: StepErrors) {
    const first = Object.keys(found)[0];
    if (!first) return;
    // After the errors render.
    requestAnimationFrame(() => {
      controlFor(first)?.focus();
    });
  }

  function onContinue() {
    const found = errorsOf(step, draft, commissions);
    setChecked((was) => new Set(was).add(step));
    if (hasErrors(found)) {
      focusFirstError(found);
      return;
    }
    const next = FORM_K_STEPS[index + 1];
    if (next) go(next);
  }

  async function onSubmit() {
    const all = new Set(FORM_K_STEPS);
    setChecked(all);
    const first = FORM_K_STEPS.find((each) => hasErrors(errorsOf(each, draft, commissions)));
    if (first) {
      if (first !== step) go(first);
      else focusFirstError(errorsOf(first, draft, commissions));
      return;
    }
    const parsed = formKDraftSchema.safeParse(draft);
    if (!parsed.success) return;
    const body = JSON.stringify(parsed.data);
    if (attempt.current?.body !== body) {
      attempt.current = { key: crypto.randomUUID(), body };
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await submit({ draft: parsed.data, idempotencyKey: attempt.current.key });
      switch (result.status) {
        case 'submitted':
          onSubmitted({ id: result.id, reference: result.reference });
          return;
        case 'invalid': {
          setRefused(result.errors);
          setFailure('invalid');
          const target = result.steps[0] ?? 'declare';
          if (target !== step) go(target);
          return;
        }
        case 'unauthenticated':
          setFailure('unauthenticated');
          return;
        default:
          setFailure('unavailable');
      }
    } catch {
      setFailure('unavailable');
    } finally {
      setBusy(false);
    }
  }

  const sections: SectionNavSection[] = FORM_K_STEPS.map((each) => ({
    id: each,
    label: STEPS[each].nav.en,
    ...(checked.has(each) && each !== step
      ? { status: hasErrors(errorsOf(each, draft, commissions)) ? 'incomplete' : 'complete' }
      : {}),
  }));

  const stepProps = { draft, update, errors };
  const isLast = step === 'declare';

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-7 sm:pb-16 lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-11 lg:pt-9">
      <aside className="hidden lg:block">
        <div className="sticky top-[84px] grid gap-4">
          <Button asChild variant="ghost" size="sm" className="justify-self-start">
            <Link to="/access/requests" search={{}}>
              <Icon icon={ArrowLeft01Icon} />
              {COPY.myRequests}
            </Link>
          </Button>
          <p className="px-2.5 text-[15px] font-semibold">{COPY.newRequest}</p>
          <SectionNav
            label={COPY.steps}
            sections={sections}
            current={step}
            statusLabels={{ complete: '', incomplete: '', 'not-started': '' }}
            onSelect={(id) => {
              go(id as FormKStep);
            }}
            footer={
              <>
                {commission ? (
                  <>
                    <span className="text-foreground">{commission.name}</span>
                    <span className="flex items-center gap-2 [&_svg]:size-4">
                      <Icon icon={Clock01Icon} />
                      {COPY.decisionWithin(commission.decisionDays)}
                    </span>
                  </>
                ) : null}
              </>
            }
          />
        </div>
      </aside>

      <div className="grid max-w-[760px] min-w-0 content-start gap-6">
        <p className="text-[13px] font-medium text-muted-foreground lg:hidden">
          {`${COPY.newRequest} · ${String(index + 1)} / ${String(FORM_K_STEPS.length)}`}
        </p>
        <div className="grid gap-1.5">
          <h1
            ref={heading}
            tabIndex={-1}
            className="text-[26px] leading-tight font-semibold tracking-[-0.02em] outline-none sm:text-[28px]"
          >
            {STEPS[step].heading.en}
          </h1>
          {step === 'officer' ? (
            <p className="text-[15px] text-muted-foreground">{COPY.officerHint}</p>
          ) : step === 'scope' ? (
            <p className="text-[15px] text-muted-foreground">{COPY.scopeHint}</p>
          ) : null}
        </div>

        {failure === 'invalid' ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>
              <strong className="font-semibold">{COPY.rejectedTitle}</strong> {COPY.rejectedText}
            </AlertDescription>
          </Alert>
        ) : null}

        {step === 'commission' ? (
          <CommissionStep {...stepProps} commissions={commissions} />
        ) : step === 'particulars' ? (
          <ParticularsStep {...stepProps} applicant={applicant} />
        ) : step === 'officer' ? (
          <OfficerStep {...stepProps} />
        ) : step === 'information' ? (
          <InformationStep {...stepProps} />
        ) : step === 'scope' ? (
          <ScopeStep {...stepProps} years={commission?.years ?? []} />
        ) : (
          <DeclareStep
            {...stepProps}
            applicant={applicant}
            commission={commission}
            now={now}
            onEdit={go}
          />
        )}

        {isLast && failure === 'unavailable' ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertTitle>{COPY.unavailableTitle}</AlertTitle>
            <AlertDescription>{COPY.unavailableText}</AlertDescription>
          </Alert>
        ) : null}
        {failure === 'unauthenticated' ? (
          <Alert variant="destructive" className="flex flex-wrap items-center gap-3">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription className="min-w-0 flex-1">{COPY.sessionEnded}</AlertDescription>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                signInAgain();
              }}
            >
              {COPY.signIn}
            </Button>
          </Alert>
        ) : null}

        <nav
          aria-label={COPY.steps}
          className="fixed inset-x-0 bottom-0 z-10 flex items-center gap-3 border-t border-border bg-background px-4 py-3 sm:static sm:border-t sm:bg-transparent sm:px-0 sm:pt-6"
        >
          {index > 0 ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const back = FORM_K_STEPS[index - 1];
                if (back) go(back);
              }}
            >
              <Icon icon={ArrowLeft01Icon} />
              {COPY.back}
            </Button>
          ) : null}
          {isLast ? (
            <Button
              type="button"
              className="flex-1 sm:ml-auto sm:min-w-[180px] sm:flex-none"
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={() => void onSubmit()}
            >
              {busy ? <Spinner /> : <Icon icon={SentIcon} />}
              {busy ? COPY.submitting : COPY.submit}
            </Button>
          ) : (
            <Button
              type="button"
              className="flex-1 sm:ml-auto sm:min-w-[180px] sm:flex-none"
              onClick={onContinue}
            >
              {COPY.continue}
              <Icon icon={ArrowRight01Icon} />
            </Button>
          )}
        </nav>
      </div>
    </div>
  );
}

/** The value at a dotted draft path, compared to tell whether a refused field was edited. */
function valueAt(draft: FormKDraft, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value !== null && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined,
      draft,
    );
}
