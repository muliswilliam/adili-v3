import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  FieldError,
  formatDate,
  Icon,
  Label,
  RadioCard,
  RadioGroup,
  SeverityBadge,
  Spinner,
  Textarea,
} from '@adili/ui';
import { Flag02Icon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useId, useState } from 'react';

import { CLARIFICATION_STATUSES } from '../../clarification/labels';
import {
  NARRATIVE_MAX_LENGTH,
  type ReferralErrors,
  type ReferralForm,
  referralErrors,
} from '../../referral/view';
import type { Clarification, Flag, ReferralInput } from '../../server/review/types';
import { DialogFailure, DialogHeading, type FailureText } from '../dialog-parts';
import { TONES } from '../review/status-badge';
import { messages as t } from './messages';

export interface ReferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "DCB-TSC-2026-0004127-E · Brian Wekesa". */
  subject: string;
  /** The case's flags a referral can rest on (`referableFlags`). */
  flags: Flag[];
  /** The case's issued clarifications (`referableClarifications`). */
  clarifications: Clarification[];
  /**
   * Sends the proposal; resolves to why it was refused or failed (shown in the dialog, the
   * answers kept), or null when it was proposed (the dialog closes).
   */
  onSubmit: (input: ReferralInput) => Promise<FailureText | null>;
}

const EMPTY: ReferralForm = { grounds: null, flagIds: [], clarificationIds: [], narrative: '' };

const GROUNDS = [
  { value: 'undeclared-assets', hint: t.refer.undeclaredHint },
  { value: 'unexplained-assets', hint: t.refer.unexplainedHint },
] as const;

/** One of `ids` toggled, kept in the order of `all`. */
function toggled(ids: string[], id: string, all: readonly { id: string }[]): string[] {
  const next = ids.includes(id) ? ids.filter((each) => each !== id) : [...ids, id];
  return all.map((each) => each.id).filter((each) => next.includes(each));
}

/** What a clarification's card says under its reference: where it got to, and when. */
function clarificationLine(each: Clarification): string {
  if (each.respondedAt) return `Responded ${formatDate(each.respondedAt)}`;
  if (each.status === 'overdue' && each.dueAt) return `No response; due ${formatDate(each.dueAt)}`;
  if (each.issuedAt) return `Issued ${formatDate(each.issuedAt)}`;
  return CLARIFICATION_STATUSES[each.status].label;
}

/**
 * Refer a case to EACC (spec 08 FE-6, S13): the grounds (undeclared or unexplained assets), the
 * flags (at least one) and clarifications it rests on, and the narrative (required, up to
 * 8,000). A supervisor approves it; the declarant is not told. A refusal (409 one already
 * waits, 403 no longer the assignee) keeps the answers.
 */
export function ReferDialog({
  open,
  onOpenChange,
  subject,
  flags,
  clarifications,
  onSubmit,
}: ReferDialogProps) {
  const [form, setForm] = useState<ReferralForm>(EMPTY);
  const [errors, setErrors] = useState<ReferralErrors>({});
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  function change(next: Partial<ReferralForm>, field: keyof ReferralErrors) {
    setForm((current) => ({ ...current, ...next }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function submit() {
    setFailure(null);
    const found = referralErrors(form);
    setErrors(found);
    if (Object.keys(found).length > 0 || form.grounds === null) return;
    setBusy(true);
    const failed = await onSubmit({
      grounds: form.grounds,
      narrative: form.narrative.trim(),
      flagIds: form.flagIds,
      clarificationIds: form.clarificationIds,
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
        <DialogHeading icon={Flag02Icon} tone="brand" title={t.refer.title} description={subject} />
        <form
          noValidate
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="gap-5">
            <DialogFailure failure={failure} />
            <RadioGroup legend={t.refer.grounds} columns={2} error={errors.grounds}>
              {GROUNDS.map((each) => (
                <RadioCard
                  key={each.value}
                  name={`${id}-grounds`}
                  value={each.value}
                  label={t.grounds[each.value]}
                  description={each.hint}
                  checked={form.grounds === each.value}
                  disabled={busy}
                  onChange={() => {
                    change({ grounds: each.value }, 'grounds');
                  }}
                />
              ))}
            </RadioGroup>

            <CheckList legend={t.refer.flags} error={errors.evidence} errorId={`${id}-evidence`}>
              {flags.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t.refer.noFlags}</p>
              ) : (
                flags.map((flag) => (
                  <CheckCard
                    key={flag.id}
                    checked={form.flagIds.includes(flag.id)}
                    disabled={busy}
                    onChange={() => {
                      change({ flagIds: toggled(form.flagIds, flag.id, flags) }, 'evidence');
                    }}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <SeverityBadge severity={flag.severity} size="sm" />
                        <span className="font-medium">{flag.title}</span>
                      </span>
                    }
                    detail={flag.indicator}
                  />
                ))
              )}
            </CheckList>

            {clarifications.length > 0 ? (
              <CheckList legend={t.refer.clarifications}>
                {clarifications.map((each) => {
                  const { label, tone } = CLARIFICATION_STATUSES[each.status];
                  return (
                    <CheckCard
                      key={each.id}
                      checked={form.clarificationIds.includes(each.id)}
                      disabled={busy}
                      onChange={() => {
                        setForm((current) => ({
                          ...current,
                          clarificationIds: toggled(
                            current.clarificationIds,
                            each.id,
                            clarifications,
                          ),
                        }));
                      }}
                      title={
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold">
                            {each.reference}
                          </span>
                          <Badge variant={TONES[tone].badge}>{label}</Badge>
                        </span>
                      }
                      detail={clarificationLine(each)}
                    />
                  );
                })}
              </CheckList>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-narrative`}>{t.refer.narrative}</Label>
              <Textarea
                id={`${id}-narrative`}
                rows={6}
                value={form.narrative}
                placeholder={t.refer.narrativePlaceholder}
                disabled={busy}
                aria-invalid={errors.narrative ? true : undefined}
                aria-describedby={`${id}-narrative-help ${id}-narrative-count`}
                onChange={(event) => {
                  change({ narrative: event.target.value }, 'narrative');
                }}
              />
              <div className="flex items-start justify-between gap-3">
                {errors.narrative ? (
                  <FieldError id={`${id}-narrative-help`}>{errors.narrative}</FieldError>
                ) : (
                  <span id={`${id}-narrative-help`} />
                )}
                <span
                  id={`${id}-narrative-count`}
                  className={
                    form.narrative.length > NARRATIVE_MAX_LENGTH
                      ? 'text-right text-[12.5px] text-destructive'
                      : 'text-right text-[12.5px] text-muted-foreground'
                  }
                >
                  {form.narrative.length.toLocaleString('en-KE')} /{' '}
                  {NARRATIVE_MAX_LENGTH.toLocaleString('en-KE')}
                </span>
              </div>
            </div>

            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Icon icon={ViewOffSlashIcon} className="size-3.5 shrink-0" />
              {t.refer.footnote}
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                {t.refer.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner /> : null}
              {t.refer.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A labelled group of `CheckCard`s, with the group's error under it. */
function CheckList({
  legend,
  error,
  errorId,
  children,
}: {
  legend: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      className="grid min-w-0 gap-2"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-1.5 text-sm leading-5 font-medium text-secondary-foreground">
        {legend}
      </legend>
      {children}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </fieldset>
  );
}

/** The prototype's `.chk-item`: a card the whole of which toggles its checkbox. */
function CheckCard({
  checked,
  disabled,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
  title: ReactNode;
  detail: ReactNode;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg bg-control p-3 shadow-control transition-shadow select-none hover:shadow-control-hover has-checked:shadow-control-selected has-disabled:cursor-not-allowed has-disabled:opacity-50"
    >
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-describedby={`${id}-detail`}
        className="mt-0.5"
      />
      <span className="grid min-w-0 gap-0.5 text-[14.5px]">
        {title}
        <span id={`${id}-detail`} className="text-[13px] text-muted-foreground">
          {detail}
        </span>
      </span>
    </label>
  );
}
