import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  FieldError,
  FieldHint,
  Icon,
  Label,
  RadioCard,
  RadioGroup,
  Spinner,
  Textarea,
} from '@adili/ui';
import { InformationCircleIcon, JusticeScale01Icon } from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import {
  NOTE_MAX_LENGTH,
  type ProposalErrors,
  type ProposalForm,
  proposalErrors,
  REASONS_MAX_LENGTH,
} from '../../determination/view';
import type { DeterminationInput } from '../../server/review/types';
import { DialogFailure, DialogHeading, type FailureText } from './dialog-parts';
import { messages as t } from './messages';

const OUTCOMES = [
  { value: 'compliant', label: 'Compliant' },
  { value: 'non-compliant', label: 'Non-compliant' },
  { value: 'further-action', label: 'Further action' },
] as const;

/** "33 / 4,000" under a field, red past the limit. */
function Counter({ id, length, max }: { id: string; length: number; max: number }) {
  return (
    <span
      id={id}
      className={
        length > max
          ? 'text-right text-[12.5px] text-destructive'
          : 'text-right text-[12.5px] text-muted-foreground'
      }
    >
      {length.toLocaleString('en-KE')} / {max.toLocaleString('en-KE')}
    </span>
  );
}

export interface ProposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "DCB-TSC-2026-0004127-E · Brian Wekesa". */
  subject: string;
  /** Revising a returned proposal: its outcome and reasons to start from, and why it came back. */
  revising?: { form: ProposalForm; returnedBy: string; reason: string } | null;
  /**
   * Sends the proposal; resolves to why it was refused or failed (shown in the dialog, the text
   * kept), or null when it was proposed (the dialog closes).
   */
  onSubmit: (input: DeterminationInput) => Promise<FailureText | null>;
}

const EMPTY: ProposalForm = { outcome: null, reasons: '', note: '' };

/**
 * Propose a compliance determination (spec 08 FE-2, S1): the outcome, the reasons (required, up
 * to 4,000) and, for further action, what is needed (up to 2,000). Approval is a supervisor's;
 * the dialog says what approval does. A refusal (409 already proposed, clarification open) keeps
 * the text.
 */
export function ProposeDialog({
  open,
  onOpenChange,
  subject,
  revising = null,
  onSubmit,
}: ProposeDialogProps) {
  const [form, setForm] = useState<ProposalForm>(revising?.form ?? EMPTY);
  const [errors, setErrors] = useState<ProposalErrors>({});
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  function change(next: Partial<ProposalForm>) {
    setForm((current) => ({ ...current, ...next }));
    // A changed field drops its error; a changed outcome drops the further-action note's too.
    setErrors((current) => ({
      ...('outcome' in next ? {} : { outcome: current.outcome }),
      ...('reasons' in next ? {} : { reasons: current.reasons }),
      ...('outcome' in next || 'note' in next ? {} : { note: current.note }),
    }));
  }

  async function submit() {
    setFailure(null);
    const found = proposalErrors(form);
    setErrors(found);
    if (Object.keys(found).length > 0 || form.outcome === null) return;
    setBusy(true);
    const failed = await onSubmit({
      outcome: form.outcome,
      reasons: form.reasons.trim(),
      furtherActionNote: form.outcome === 'further-action' ? form.note.trim() : null,
    });
    setBusy(false);
    setFailure(failed);
    if (!failed) setForm(EMPTY);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setErrors({});
          setFailure(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent busy={busy} className="sm:max-w-[720px]">
        <DialogHeading
          icon={JusticeScale01Icon}
          title={revising ? t.dialog.reviseTitle : t.dialog.title}
          description={subject}
        />
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="gap-4">
            <DialogFailure failure={failure} />
            {revising ? (
              <Alert variant="warning" role="note">
                <Icon icon={InformationCircleIcon} />
                <AlertDescription>
                  <b className="font-semibold">{t.dialog.returnedReason(revising.returnedBy)}</b>{' '}
                  {revising.reason}
                </AlertDescription>
              </Alert>
            ) : null}
            <RadioGroup legend={t.dialog.outcome} columns={3} error={errors.outcome}>
              {OUTCOMES.map((each) => (
                <RadioCard
                  key={each.value}
                  name={`${id}-outcome`}
                  value={each.value}
                  label={each.label}
                  checked={form.outcome === each.value}
                  disabled={busy}
                  onChange={() => {
                    change({ outcome: each.value });
                  }}
                />
              ))}
            </RadioGroup>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-reasons`}>{t.dialog.reasons}</Label>
              <Textarea
                id={`${id}-reasons`}
                rows={6}
                value={form.reasons}
                placeholder={t.dialog.reasonsPlaceholder}
                disabled={busy}
                aria-invalid={errors.reasons ? true : undefined}
                aria-describedby={`${id}-reasons-help ${id}-reasons-count`}
                onChange={(event) => {
                  change({ reasons: event.target.value });
                }}
              />
              <div className="flex items-start justify-between gap-3">
                {errors.reasons ? (
                  <FieldError id={`${id}-reasons-help`}>{errors.reasons}</FieldError>
                ) : (
                  <span id={`${id}-reasons-help`} />
                )}
                <Counter
                  id={`${id}-reasons-count`}
                  length={form.reasons.length}
                  max={REASONS_MAX_LENGTH}
                />
              </div>
            </div>
            {form.outcome === 'further-action' ? (
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-note`}>{t.dialog.note}</Label>
                <Textarea
                  id={`${id}-note`}
                  rows={3}
                  value={form.note}
                  placeholder={t.dialog.notePlaceholder}
                  disabled={busy}
                  aria-invalid={errors.note ? true : undefined}
                  aria-describedby={`${id}-note-help ${id}-note-count`}
                  onChange={(event) => {
                    change({ note: event.target.value });
                  }}
                />
                <div className="flex items-start justify-between gap-3">
                  {errors.note ? (
                    <FieldError id={`${id}-note-help`}>{errors.note}</FieldError>
                  ) : (
                    <FieldHint id={`${id}-note-help`}>{t.dialog.noteHint}</FieldHint>
                  )}
                  <Counter
                    id={`${id}-note-count`}
                    length={form.note.length}
                    max={NOTE_MAX_LENGTH}
                  />
                </div>
              </div>
            ) : null}
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Icon icon={InformationCircleIcon} className="size-3.5 shrink-0" />
              {t.dialog.consequence}
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t.dialog.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t.dialog.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
