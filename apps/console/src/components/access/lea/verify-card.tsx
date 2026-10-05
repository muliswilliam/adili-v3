import {
  Alert,
  AlertDescription,
  Button,
  CheckboxItem,
  FieldError,
  formatDate,
  FormField,
  Icon,
  Spinner,
  Textarea,
  useIdempotencyKey,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';

import type { AccessResult } from '../../../server/access-requests.server';
import type { LeaRequest } from '../../../server/access/types';
import { findLeaRosterCandidates, verifyLea } from '../../../server/lea-requests';
import { goToSignIn } from '../../sign-in-redirect';
import { RosterCandidatePicker } from '../roster-candidate-picker';
import { SideCard } from '../side-cards';
import { leaActionFailure, leaNoteError } from './lea-view';
import { messages as m } from './messages';

interface Errors {
  provenance?: string;
  reason?: string;
  record?: string;
  note?: string;
}

/**
 * "Verify" (S11, Regs r.23(1)): the access officer confirms the request comes from the agency
 * account it shows and states its reason, finds the officer sought on the Commission's roster
 * and notes what they checked. A request that cannot be verified is denied instead.
 */
export function LeaVerifyCard({ request }: { request: LeaRequest }) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const sought = request.officerSought;
  const prefill = (sought.personnelFileNumber ?? sought.name).trim();
  const [provenance, setProvenance] = useState(false);
  const [reason, setReason] = useState(false);
  const [record, setRecord] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useIdempotencyKey();
  const submit = async () => {
    const next: Errors = {
      provenance: provenance ? undefined : m.provenanceRequired,
      reason: reason ? undefined : m.reasonRequired,
      record: record ? undefined : m.recordRequired,
      note: leaNoteError(note) ?? undefined,
    };
    setErrors(next);
    setProblem(null);
    if (!record || Object.values(next).some(Boolean)) return;
    setBusy(true);
    const body = { requestId: request.id, rosterRecordId: record, note: note.trim() };
    const result = await verifyLea({
      data: { ...body, idempotencyKey: idempotencyKey.keyFor(body) },
    }).catch((): AccessResult<LeaRequest> => ({
      ok: false,
      error: { kind: 'unavailable', detail: null },
    }));
    setBusy(false);
    if (result.ok) {
      toast({ title: m.verified });
      await router.invalidate();
      return;
    }
    const failure = leaActionFailure(result.error);
    if (failure.signIn) {
      goToSignIn();
      return;
    }
    if (failure.stale) {
      toast({ title: failure.message, urgency: 'assertive' });
      await router.invalidate();
      return;
    }
    if (failure.record) {
      setErrors({ ...next, record: failure.message });
      return;
    }
    setProblem(failure.message);
  };

  const { provenance: account } = request;

  return (
    <SideCard id="verify" title={m.verifyTitle}>
      <ul className="grid gap-2 text-sm">
        <Fact>
          {m.provenanceFact(request.agency.code, request.officer.name)}
          {account.activatedAt ? m.activatedOn(formatDate(account.activatedAt)) : ''}
        </Fact>
        <Fact>{m.mandateFact(account.agencyLegalBasis)}</Fact>
      </ul>

      <div className="grid gap-2">
        <Confirm
          id={`${id}-provenance`}
          label={m.provenanceConfirmed}
          checked={provenance}
          error={errors.provenance}
          onChange={(checked) => {
            setProvenance(checked);
            if (errors.provenance) setErrors({ ...errors, provenance: undefined });
          }}
        />
        <Confirm
          id={`${id}-reason`}
          label={m.reasonConfirmed}
          checked={reason}
          error={errors.reason}
          onChange={(checked) => {
            setReason(checked);
            if (errors.reason) setErrors({ ...errors, reason: undefined });
          }}
        />
      </div>

      <div className="grid gap-2">
        <span className="text-sm font-medium text-secondary-foreground" id={`${id}-roster`}>
          {m.onTheRoster}
        </span>
        <RosterCandidatePicker
          id={`${id}-search`}
          find={(q) => findLeaRosterCandidates({ data: { requestId: request.id, q } })}
          prefill={prefill}
          choice={{
            kind: 'radio',
            name: `${id}-record`,
            selected: record,
            error: errors.record,
            onSelect: (candidate) => {
              setRecord(candidate.id);
              if (errors.record) setErrors({ ...errors, record: undefined });
            },
          }}
          notOnboardedHint={m.notOnboardedHint}
          allowNotOnboarded
          withEntity
        />
      </div>

      <form
        noValidate
        className="grid gap-3.5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <FormField label={m.note} hint={m.noteHint} error={errors.note} controlId={`${id}-note`}>
          <Textarea
            rows={3}
            maxLength={1000}
            value={note}
            placeholder={m.notePlaceholder}
            onChange={(event) => {
              setNote(event.target.value);
              if (errors.note) setErrors({ ...errors, note: undefined });
            }}
          />
        </FormField>
        {problem ? (
          <Alert variant="destructive" role="alert">
            <Icon icon={AlertCircleIcon} />
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? <Spinner className="size-4" /> : <Icon icon={UserCheck01Icon} />}
          {m.recordVerification}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-[13.5px] text-muted-foreground">{m.cannotVerify}</span>
        <Button asChild variant="destructive-ghost" size="sm">
          <Link
            to="/access/lea-requests/$leaRequestId/decide"
            params={{ leaRequestId: request.id }}
          >
            {m.denyInstead}
          </Link>
        </Button>
      </div>
    </SideCard>
  );
}

function Fact({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-secondary-foreground">
      <Icon
        icon={CheckmarkCircle02Icon}
        className="mt-0.5 size-4 shrink-0 text-success"
        strokeWidth={2.2}
      />
      <span>{children}</span>
    </li>
  );
}

function Confirm({
  id,
  label,
  checked,
  error,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid gap-1">
      <CheckboxItem
        id={id}
        label={label}
        checked={checked}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
