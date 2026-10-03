import {
  Alert,
  AlertTitle,
  type ApprovalConsequence,
  ApprovalConsequences,
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
  Spinner,
  Textarea,
} from '@adili/ui';
import {
  Archive02Icon,
  Cancel01Icon,
  Flag02Icon,
  HashtagIcon,
  SentIcon,
} from '@hugeicons/core-free-icons';
import { useId, useState } from 'react';

import { DECLINE_NOTE_MAX_LENGTH } from '../../referral/view';
import type { ReferralGrounds } from '../../server/review/types';
import { DialogFailure, DialogHeading, type FailureText } from '../determination/dialog-parts';
import { messages as t } from './messages';

/** What a decision dialog names: the declarant, the grounds and how much the package holds. */
export interface ReferralSubject {
  id: string;
  declarantName: string;
  grounds: ReferralGrounds;
  /** Items the package will list (the cover sheet's manifest). */
  evidenceItems: number;
}

/** What approving a referral does, in text before the approver decides (S13). */
export function referralConsequences(subject: ReferralSubject): ApprovalConsequence[] {
  return [
    { icon: HashtagIcon, title: t.approveDialog.rfl },
    {
      icon: Archive02Icon,
      title: t.approveDialog.package,
      detail: t.approveDialog.packageDetail(subject.evidenceItems),
    },
    { icon: SentIcon, title: t.approveDialog.eacc, detail: t.approveDialog.eaccDetail },
  ];
}

/**
 * Approve a referral to EACC (spec 08 FE-6): the declarant is not notified, said first, then
 * what approval does. Resolves to a failure to show in the dialog, or null once handled.
 */
export function ApproveReferralDialog({
  subject,
  onOpenChange,
  onConfirm,
}: {
  subject: ReferralSubject | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: ReferralSubject) => Promise<FailureText | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<FailureText | null>(null);
  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(open) => {
        if (!open) setFailure(null);
        onOpenChange(open);
      }}
    >
      {subject ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={Flag02Icon}
            tone="brand"
            title={t.approveDialog.title}
            description={t.approveDialog.subject(subject.declarantName, t.grounds[subject.grounds])}
          />
          <DialogBody className="gap-4">
            <DialogFailure failure={failure} />
            <Alert variant="brand" role="note">
              <Icon icon={SentIcon} />
              <AlertTitle>{t.approveDialog.callout}</AlertTitle>
            </Alert>
            <ApprovalConsequences
              items={referralConsequences(subject)}
              heading={t.approveDialog.consequences}
              headingLevel={3}
            />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">{t.approveDialog.cancel}</Button>
            </DialogClose>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setFailure(null);
                void onConfirm(subject).then((failed) => {
                  setBusy(false);
                  setFailure(failed);
                });
              }}
            >
              {busy ? <Spinner /> : <Icon icon={SentIcon} />}
              {t.approveDialog.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** What is wrong with a decline note, or null. */
export function declineNoteError(note: string): string | null {
  if (!note.trim()) return t.declineDialog.required;
  if (note.length > DECLINE_NOTE_MAX_LENGTH) return t.declineDialog.tooLong;
  return null;
}

/** Decline a referral with a note (required, up to 2,000); nothing goes to EACC. */
export function DeclineReferralDialog({
  subject,
  onOpenChange,
  onConfirm,
}: {
  subject: ReferralSubject | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (subject: ReferralSubject, note: string) => Promise<FailureText | null>;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<FailureText | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <Dialog
      open={subject !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNote('');
          setError(null);
          setFailure(null);
        }
        onOpenChange(open);
      }}
    >
      {subject ? (
        <DialogContent busy={busy} className="sm:max-w-[560px]">
          <DialogHeading
            icon={Cancel01Icon}
            title={t.declineDialog.title}
            description={t.approveDialog.subject(subject.declarantName, t.grounds[subject.grounds])}
          />
          <form
            noValidate
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              setFailure(null);
              const problem = declineNoteError(note);
              setError(problem);
              if (problem) return;
              setBusy(true);
              void onConfirm(subject, note.trim()).then((failed) => {
                setBusy(false);
                setFailure(failed);
              });
            }}
          >
            <DialogBody className="gap-4">
              <DialogFailure failure={failure} />
              <div className="grid gap-1.5">
                <Label htmlFor={`${id}-note`}>{t.declineDialog.note}</Label>
                <Textarea
                  id={`${id}-note`}
                  rows={4}
                  value={note}
                  placeholder={t.declineDialog.placeholder}
                  disabled={busy}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={`${id}-note-help`}
                  onChange={(event) => {
                    setNote(event.target.value);
                    if (error) setError(null);
                  }}
                />
                <div className="flex items-start justify-between gap-3">
                  {error ? (
                    <FieldError id={`${id}-note-help`}>{error}</FieldError>
                  ) : (
                    <FieldHint id={`${id}-note-help`}>{t.declineDialog.hint}</FieldHint>
                  )}
                  <span
                    className={
                      note.length > DECLINE_NOTE_MAX_LENGTH
                        ? 'text-[12.5px] text-destructive'
                        : 'text-[12.5px] text-muted-foreground'
                    }
                  >
                    {note.length.toLocaleString('en-KE')} /{' '}
                    {DECLINE_NOTE_MAX_LENGTH.toLocaleString('en-KE')}
                  </span>
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {t.declineDialog.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner /> : null}
                {t.declineDialog.confirm}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
