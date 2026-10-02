import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  DeadlineChip,
  FormField,
  type Ground,
  GroundsSelect,
  groundMeta,
  Icon,
  RadioCard,
  RadioGroup,
  type Scope,
  ScopePicker,
  Textarea,
  useIdempotencyKey,
} from '@adili/ui';
import { AlertCircleIcon, Alert02Icon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useRef, useState } from 'react';

import type { AccessProblem } from '../../../server/access/types';
import type { ServiceResult } from '../../../server/service-call';
import { goToSignIn } from '../../sign-in-redirect';
import { Muted, SideCard } from '../side-cards';
import { DecisionConfirmDialog } from './decision-confirm-dialog';
import {
  type DecisionDraft,
  type DecisionErrors,
  type DecisionFailure,
  type DecisionFailureCopy,
  type DecisionInput,
  decisionErrors,
  decisionFailure,
  decisionInput,
  emptyDraft,
  emptyScope,
  canNarrow,
  hasErrors,
  isWholeScope,
  needsGrounds,
  type Outcome,
  REASONS_MAX,
} from './decision-rules';
import { messages as m } from './messages';
import { type PreviewScope, ScopePreviewPanel, useScopePreview } from './scope-preview';
import { scopeText } from '../format';

const ALL_OUTCOMES: readonly Outcome[] = ['grant', 'partial-grant', 'deny'];

/** Never called: without a preview function, there is never a scope to count. */
const NO_PREVIEW: PreviewScope = () => Promise.reject(new Error('No scope preview'));

export interface DecisionFormProps {
  /** What the request asked for: a grant releases it, a partial grant narrows it. */
  requestedScope: Scope;
  /** The outcomes on offer, in order; all three by default. */
  outcomes?: readonly Outcome[];
  /**
   * Whether the scope can cover the declarant's clarifications: Form K may, law enforcement
   * requests never do (their scope keeps them false).
   */
  clarifications?: boolean;
  /** The decision deadline, shown in the card's header. */
  deadline: { due: string; soonDays: number };
  /** Under the reasons: who reads them, e.g. "Sent to the applicant and the declarant." */
  reasonsHint: string;
  /** The confirm dialog's first line: the decision is final, and who is told. */
  finality: (outcome: Outcome) => { title: string; text?: string };
  /** Who a grant's package goes to, e.g. the applicant's name. */
  packageRecipient: string;
  /**
   * Records the decision. The key is the request's Idempotency-Key: the same while the officer
   * retries the same decision, a new one once they change it.
   */
  submit: (
    input: DecisionInput,
    idempotencyKey: string,
  ) => Promise<ServiceResult<unknown, AccessProblem>>;
  /** After the decision is recorded, e.g. back to the request with a toast. */
  onDecided: () => void | Promise<void>;
  /** Back to the request without deciding (Cancel, and "Open the request" once it moved on). */
  onCancel: () => void;
  /** How refusals read for this kind of request, when not as for Form K. */
  failureCopy?: DecisionFailureCopy;
  /**
   * Counts what a scope holds of the declarant's declarations (decision 1): the requested scope,
   * or the one a partial grant narrows it to, shown before the officer confirms. None: nothing
   * to count yet (a law enforcement request not verified, which can only be denied).
   */
  preview?: PreviewScope;
}

/**
 * The access officer's decision (spec 10 S6, #260): Grant, Partial grant or Deny; a partial grant
 * narrows the requested scope (nothing outside it can be ticked); a partial grant or a denial
 * cites Regulation 24 grounds, whose text is quoted; reasons always. Checked as the access
 * service checks it, then confirmed (decisions are final) before it is sent. The service's
 * refusals show in the form: a 400 by field, a 409 offers the request instead. Used for Form K
 * requests and law enforcement requests (#265).
 */
export function DecisionForm({
  requestedScope,
  outcomes = ALL_OUTCOMES,
  clarifications = false,
  deadline,
  reasonsHint,
  finality,
  packageRecipient,
  submit,
  onDecided,
  onCancel,
  failureCopy,
  preview,
}: DecisionFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<DecisionDraft>(emptyDraft);
  const [errors, setErrors] = useState<DecisionErrors>({});
  const [failure, setFailure] = useState<DecisionFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useIdempotencyKey();
  const problemRef = useRef<HTMLDivElement>(null);

  const update = (next: Partial<DecisionDraft>, clear: (keyof DecisionErrors)[]) => {
    setDraft((current) => ({ ...current, ...next }));
    if (clear.some((field) => errors[field])) {
      setErrors((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([field]) => !clear.includes(field as keyof DecisionErrors),
          ),
        ),
      );
    }
  };

  const review = () => {
    const found = decisionErrors(draft, requestedScope);
    setErrors(found);
    setFailure(null);
    if (hasErrors(found)) {
      focusFirstError(id, found);
      return;
    }
    setConfirming(true);
  };

  const record = async () => {
    if (!draft.outcome) return;
    const input = decisionInput({ ...draft, outcome: draft.outcome });
    setBusy(true);
    // A retry of the same decision replays; a changed one is a new request to the service.
    const result = await submit(input, idempotencyKey.keyFor(input)).catch(
      (): ServiceResult<unknown, AccessProblem> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }),
    );
    if (result.ok) {
      await onDecided();
      setBusy(false);
      return;
    }
    setBusy(false);
    setConfirming(false);
    const failed = decisionFailure(result.error, failureCopy);
    if (failed.signIn) {
      goToSignIn();
      return;
    }
    setFailure(failed);
    setErrors(failed.errors);
    requestAnimationFrame(() => problemRef.current?.focus());
  };

  const showScope = draft.outcome === 'partial-grant';
  // What a grant of the scope in hand would disclose: the requested one until the officer
  // narrows it; nothing to count for a denial, or a narrowed scope with no year or section.
  const previewed =
    !preview || draft.outcome === 'deny'
      ? null
      : showScope
        ? draft.scope.years.length > 0 && draft.scope.sections.length > 0
          ? draft.scope
          : null
        : requestedScope;
  const counted = useScopePreview(previewed, preview ?? NO_PREVIEW);
  const nothingHeld = counted.state === 'ready' && counted.preview.empty;
  const narrowable = canNarrow(requestedScope);
  const whole = isWholeScope(draft, requestedScope);
  const scopeError = errors.scope && !(whole && errors.scope === m.sameAsRequested);

  return (
    <SideCard
      id="decide"
      title={m.decisionTitle}
      actions={
        <DeadlineChip due={deadline.due} soonDays={deadline.soonDays} label={m.decisionDue} />
      }
    >
      <form
        noValidate
        className="grid gap-5 pt-0.5 [&_input]:scroll-mt-28 [&_textarea]:scroll-mt-28"
        onSubmit={(event) => {
          event.preventDefault();
          review();
        }}
      >
        {failure ? (
          <div ref={problemRef} tabIndex={-1} className="scroll-mt-24 rounded-lg outline-none">
            <Alert variant="destructive">
              <Icon icon={AlertCircleIcon} />
              <AlertTitle>{failure.title}</AlertTitle>
              <AlertDescription>{failure.message}</AlertDescription>
              {failure.stale ? (
                <AlertDescription className="mt-2">
                  <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
                    {m.openRequest}
                  </Button>
                </AlertDescription>
              ) : null}
            </Alert>
          </div>
        ) : null}

        <RadioGroup
          id={`${id}-outcome`}
          legend={m.outcome}
          error={errors.outcome}
          columns={outcomes.length === 3 ? 3 : 2}
        >
          {outcomes.map((outcome) => (
            <RadioCard
              key={outcome}
              name={`${id}-outcome`}
              value={outcome}
              label={m.outcomes[outcome]}
              checked={draft.outcome === outcome}
              disabled={busy || (outcome === 'partial-grant' && !narrowable)}
              description={
                outcome === 'partial-grant' && !narrowable ? m.nothingToNarrow : undefined
              }
              onChange={() => {
                update(
                  {
                    outcome,
                    // A grant cites no grounds; a fresh partial grant starts from nothing ticked.
                    grounds: needsGrounds(outcome) ? draft.grounds : [],
                    scope: outcome === 'partial-grant' ? draft.scope : emptyScope(),
                  },
                  ['outcome', 'years', 'sections', 'scope', 'grounds'],
                );
              }}
            />
          ))}
        </RadioGroup>

        {draft.outcome === 'grant' ? (
          <Muted>{m.grantReleases(scopeText(requestedScope))}</Muted>
        ) : null}

        {showScope ? (
          <div
            id={`${id}-scope`}
            className="grid gap-2"
            role="group"
            aria-labelledby={`${id}-scope-label`}
          >
            <div className="grid gap-0.5">
              <span
                id={`${id}-scope-label`}
                className="text-sm leading-5 font-medium text-secondary-foreground"
              >
                {m.grantedScope}
              </span>
              <span className="text-[13px] text-muted-foreground">{m.grantedScopeHint}</span>
            </div>
            <ScopePicker
              name={`${id}-scope`}
              value={draft.scope}
              onChange={(scope) => {
                update({ scope }, ['years', 'sections', 'scope']);
              }}
              years={requestedScope.years}
              restrictTo={requestedScope}
              clarifications={clarifications}
              errors={{ years: errors.years, sections: errors.sections }}
              disabled={busy}
            />
            {whole ? (
              <Alert variant="warning">
                <Icon icon={Alert02Icon} />
                <AlertDescription>{m.sameAsRequested}</AlertDescription>
              </Alert>
            ) : scopeError ? (
              <Alert variant="destructive">
                <Icon icon={AlertCircleIcon} />
                <AlertDescription>{errors.scope}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        <ScopePreviewPanel
          preview={counted}
          heading={showScope ? m.previewGranted : m.previewRequested}
        />

        {needsGrounds(draft.outcome) ? (
          <div id={`${id}-grounds`}>
            <GroundsSelect
              name={`${id}-grounds`}
              value={draft.grounds}
              onChange={(grounds: Ground[]) => {
                update({ grounds }, ['grounds']);
              }}
              error={errors.grounds}
              disabled={busy}
            />
          </div>
        ) : null}

        {draft.outcome ? (
          <FormField
            label={m.reasons}
            hint={<ReasonsHint text={reasonsHint} count={draft.reasons.trim().length} />}
            error={errors.reasons}
            controlId={`${id}-reasons`}
          >
            <Textarea
              rows={5}
              value={draft.reasons}
              placeholder={m.reasonsPlaceholder}
              disabled={busy}
              onChange={(event) => {
                update({ reasons: event.target.value }, ['reasons']);
              }}
            />
          </FormField>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {m.cancel}
          </Button>
          <Button type="submit" disabled={busy}>
            <Icon icon={JusticeScale01Icon} />
            {m.recordDecision}
          </Button>
        </div>
      </form>

      {draft.outcome ? (
        <DecisionConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            if (!busy) setConfirming(open);
          }}
          busy={busy}
          outcome={draft.outcome}
          finality={finality(draft.outcome)}
          packageRecipient={packageRecipient}
          packageScope={scopeText(draft.outcome === 'partial-grant' ? draft.scope : requestedScope)}
          nilLetter={nothingHeld}
          grounds={draft.grounds.map((ground) => groundMeta[ground].label)}
          onConfirm={() => void record()}
        />
      ) : null}
    </SideCard>
  );
}

function ReasonsHint({ text, count }: { text: string; count: number }): ReactNode {
  return (
    <span className="flex flex-wrap justify-between gap-x-3">
      <span>{text}</span>
      <span className={count > REASONS_MAX ? 'font-medium text-destructive' : undefined}>
        {m.reasonsCount(count)}
      </span>
    </span>
  );
}

/** Moves focus to the first field at fault, top to bottom. */
function focusFirstError(id: string, errors: DecisionErrors) {
  const target = errors.outcome
    ? `#${CSS.escape(`${id}-outcome`)} input`
    : errors.years || errors.sections || errors.scope
      ? `#${CSS.escape(`${id}-scope`)} input:not(:disabled)`
      : errors.grounds
        ? `#${CSS.escape(`${id}-grounds`)} input`
        : errors.reasons
          ? `#${CSS.escape(`${id}-reasons`)}`
          : null;
  if (!target) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(target)?.focus();
  });
}
