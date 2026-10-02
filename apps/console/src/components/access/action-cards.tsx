import {
  Alert,
  AlertDescription,
  Button,
  CheckboxItem,
  FieldError,
  FormField,
  Icon,
  Spinner,
  Textarea,
  useIdempotencyKey,
  useToast,
  formatPhone,
} from '@adili/ui';
import { AlertCircleIcon, UserCheck01Icon, UserRemove01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useId, useState } from 'react';

import {
  findRosterCandidates,
  resolveRequestedOfficer,
  verifyApplicantIdentity,
} from '../../server/access-requests';
import type { AccessResult } from '../../server/access-requests.server';
import type { OfficerRequestView, RosterCandidate } from '../../server/access/types';
import { goToSignIn } from '../sign-in-redirect';
import { formKOf } from './form-k-card';
import { messages as m } from './messages';
import { actionFailure, verifyNoteError } from './request-view';
import { CannotIdentifyDialog, ResolveDialog } from './resolve-dialogs';
import { RosterCandidatePicker } from './roster-candidate-picker';
import { Muted, SideCard } from './side-cards';

/**
 * Runs a command against the request and folds its answer: success reloads the page with a
 * toast; a stale page (403, 404, 409) closes the dialog, says why and reloads; anything else
 * stays in the dialog to retry with the same Idempotency-Key.
 */
function useCommand() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (
    command: () => Promise<AccessResult<OfficerRequestView>>,
    success: string,
    { onDone }: { onDone: () => void },
  ) => {
    setBusy(true);
    setError(null);
    const result = await command().catch((): AccessResult<OfficerRequestView> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    if (result.ok) {
      onDone();
      toast({ title: success });
      await router.invalidate();
      return;
    }
    const failure = actionFailure(result.error);
    if (failure.signIn) {
      goToSignIn();
      return;
    }
    if (failure.stale) {
      onDone();
      toast({ title: failure.message, urgency: 'assertive' });
      await router.invalidate();
      return;
    }
    setError(failure.message);
  };
  return { busy, error, setError, run };
}

/**
 * "Verify applicant identity" for a passport applicant's request (S2): the access officer checks the
 * particulars entered against the passport and records how. The request is then released to
 * be identified.
 */
export function VerifyApplicantCard({ view }: { view: OfficerRequestView }) {
  const id = useId();
  const { partI } = formKOf(view);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ checked?: string; note?: string }>({});
  const idempotencyKey = useIdempotencyKey();
  const command = useCommand();

  const submit = () => {
    const next = {
      checked: checked ? undefined : m.checkRequired,
      note: verifyNoteError(note) ?? undefined,
    };
    setErrors(next);
    if (next.checked || next.note) return;
    const body = { requestId: view.id, note: note.trim() };
    void command.run(
      () =>
        verifyApplicantIdentity({ data: { ...body, idempotencyKey: idempotencyKey.keyFor(body) } }),
      m.verified,
      { onDone: () => undefined },
    );
  };

  return (
    <SideCard id="verify" title={m.verifyTitle}>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.passportLabel}</dt>
          <dd className="mt-0.5 font-medium">
            {partI.identityDocument.number} · {partI.identityDocument.country}
          </dd>
        </div>
        <div>
          <dt className="text-[13px] text-muted-foreground">{m.phoneLabel}</dt>
          <dd className="mt-0.5">
            <span className="font-medium">{formatPhone(partI.telephone)}</span>{' '}
            <span className="text-[13px] text-muted-foreground">{m.confirmedByCode}</span>
          </dd>
        </div>
      </dl>
      <form
        noValidate
        className="grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="grid gap-1.5">
          <CheckboxItem
            id={`${id}-checked`}
            label={m.particularsChecked}
            checked={checked}
            aria-invalid={errors.checked ? true : undefined}
            aria-describedby={errors.checked ? `${id}-checked-error` : undefined}
            onChange={(event) => {
              setChecked(event.target.checked);
              if (errors.checked) setErrors({ ...errors, checked: undefined });
            }}
          />
          {errors.checked ? (
            <FieldError id={`${id}-checked-error`}>{errors.checked}</FieldError>
          ) : null}
        </div>
        <FormField label={m.verifyNote} hint={m.verifyNoteHint} error={errors.note}>
          <Textarea
            id={`${id}-note`}
            rows={3}
            maxLength={1000}
            value={note}
            placeholder={m.verifyNotePlaceholder}
            onChange={(event) => {
              setNote(event.target.value);
              if (errors.note) setErrors({ ...errors, note: undefined });
            }}
          />
        </FormField>
        {command.error ? (
          <Alert variant="destructive">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{command.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={command.busy} aria-busy={command.busy || undefined}>
          {command.busy ? <Spinner className="size-4" /> : <Icon icon={UserCheck01Icon} />}
          {m.recordVerification}
        </Button>
      </form>
    </SideCard>
  );
}
/**
 * "Identify officer" (S3): the access officer searches the Commission's roster by name or
 * personnel file number and selects the record the officer Form K names is, or records that
 * they cannot be identified. Any record can be chosen: an onboarded one's declarant is notified
 * online; the officer of one not onboarded is invited to onboard and served in writing.
 */
export function IdentifyOfficerCard({ view, now }: { view: OfficerRequestView; now: string }) {
  const id = useId();
  const { partII } = formKOf(view);
  // A file number Form K gives is searched for at once.
  const prefill = (partII.personnelFileNumber ?? '').trim();
  const [selected, setSelected] = useState<RosterCandidate | null>(null);
  const [cannot, setCannot] = useState(false);
  // One key per decision: kept across retries of the same dialog, new when it opens again.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const command = useCommand();
  const openDialog = (next: { record?: RosterCandidate; cannot?: boolean }) => {
    setKey(crypto.randomUUID());
    command.setError(null);
    setSelected(next.record ?? null);
    setCannot(next.cannot ?? false);
  };
  const closeDialogs = () => {
    setSelected(null);
    setCannot(false);
  };

  const resolve = (rosterRecordId: string | null, success: string) =>
    command.run(
      () =>
        resolveRequestedOfficer({
          data: { requestId: view.id, rosterRecordId, idempotencyKey: key },
        }),
      success,
      { onDone: closeDialogs },
    );

  const named = [partII.entity, partII.workStation].filter(Boolean).join(', ');

  return (
    <SideCard id="identify" title={m.identifyTitle}>
      <Muted>
        {m.formKNames} <b className="font-semibold text-foreground">{partII.name}</b>
        {named ? `, ${named}` : ''}
        {partII.personnelFileNumber ? `, ${m.fileNumberInline(partII.personnelFileNumber)}` : ''}.
      </Muted>
      <RosterCandidatePicker
        id={`${id}-search`}
        find={(q) => findRosterCandidates({ data: { requestId: view.id, q } })}
        prefill={prefill}
        choice={{
          kind: 'select',
          onSelect: (record) => {
            openDialog({ record });
          },
        }}
        notOnboardedHint={m.notOnboardedHint}
        allowNotOnboarded
        withEntity
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[13.5px] text-muted-foreground">{m.notOnTheRoster}</span>
        <Button
          variant="destructive-ghost"
          size="sm"
          onClick={() => {
            openDialog({ cannot: true });
          }}
        >
          <Icon icon={UserRemove01Icon} />
          {m.cannotIdentify}
        </Button>
      </div>

      <ResolveDialog
        open={selected !== null}
        record={selected}
        now={now}
        windowDays={view.representationWindowDays}
        busy={command.busy}
        error={command.error}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onConfirm={() => {
          if (selected) {
            void resolve(
              selected.id,
              selected.onboarded
                ? m.identified(selected.fullName)
                : m.identifiedNoAccount(selected.fullName),
            );
          }
        }}
      />
      <CannotIdentifyDialog
        open={cannot}
        busy={command.busy}
        error={command.error}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onConfirm={() => void resolve(null, m.closed)}
      />
    </SideCard>
  );
}
