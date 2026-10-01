import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CheckboxItem,
  FieldError,
  FormField,
  Icon,
  Spinner,
  Textarea,
  useToast,
} from '@adili/ui';
import { AlertCircleIcon, UserCheck01Icon, UserRemove01Icon } from '@hugeicons/core-free-icons';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import {
  findRosterCandidates,
  resolveRequestedOfficer,
  verifyApplicantIdentity,
} from '../../server/access-requests';
import type { AccessResult } from '../../server/access-requests.server';
import type {
  OfficerRequestView,
  RosterCandidate,
  RosterCandidates,
} from '../../server/access/types';
import { SearchBox } from '../search-box';
import { goToSignIn } from '../sign-in-redirect';
import { formatPhone, formKOf } from './form-k-card';
import { messages as m } from './messages';
import { actionFailure, verifyNoteError } from './request-view';
import { CannotIdentifyDialog, ResolveDialog } from './resolve-dialogs';
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
 * "Verify applicant" for a passport applicant's request (S2): the access officer checks the
 * particulars entered against the passport and records how. The request is then released to
 * be identified.
 */
export function VerifyApplicantCard({ view }: { view: OfficerRequestView }) {
  const id = useId();
  const { partI } = formKOf(view);
  const [checked, setChecked] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ checked?: string; note?: string }>({});
  const [key] = useState(() => crypto.randomUUID());
  const command = useCommand();

  const submit = () => {
    const next = {
      checked: checked ? undefined : m.checkRequired,
      note: verifyNoteError(note) ?? undefined,
    };
    setErrors(next);
    if (next.checked || next.note) return;
    void command.run(
      () =>
        verifyApplicantIdentity({
          data: { requestId: view.id, note: note.trim(), idempotencyKey: key },
        }),
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

type Search =
  | { state: 'idle' }
  | { state: 'searching'; q: string }
  | { state: 'done'; q: string; result: AccessResult<RosterCandidates> };

/**
 * "Identify officer" (S3): the access officer searches the Commission's roster by name or
 * personnel file number and selects the record the officer Form K names is, or records that
 * they cannot be identified. Only an onboarded record can be chosen: its declarant is notified.
 */
export function IdentifyOfficerCard({ view, now }: { view: OfficerRequestView; now: string }) {
  const id = useId();
  const { partII } = formKOf(view);
  // A file number Form K gives is searched for at once.
  const prefill = (partII.personnelFileNumber ?? '').trim();
  const [query, setQuery] = useState(prefill);
  const [search, setSearch] = useState<Search>(() =>
    prefill.length >= 2 ? { state: 'searching', q: prefill } : { state: 'idle' },
  );
  const [selected, setSelected] = useState<RosterCandidate | null>(null);
  const [cannot, setCannot] = useState(false);
  // One key per decision: kept across retries of the same dialog, new when it opens again.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const command = useCommand();
  // Only the latest search's answer is shown.
  const latest = useRef(0);

  const fetchCandidates = (q: string) => {
    const ticket = ++latest.current;
    void findRosterCandidates({ data: { requestId: view.id, q } })
      .catch((): AccessResult<RosterCandidates> => ({
        ok: false,
        error: { kind: 'unavailable', detail: null },
      }))
      .then((result) => {
        if (ticket !== latest.current) return;
        if (!result.ok && result.error.kind === 'unauthenticated') {
          goToSignIn();
          return;
        }
        setSearch({ state: 'done', q, result });
      });
  };
  const searchPrefill = useEffectEvent(() => {
    if (prefill.length >= 2) fetchCandidates(prefill);
  });
  useEffect(() => {
    searchPrefill();
  }, []);

  const runSearch = (value: string) => {
    const q = value.trim();
    setQuery(q);
    if (q.length < 2) {
      latest.current += 1;
      setSearch({ state: 'idle' });
      return;
    }
    setSearch({ state: 'searching', q });
    fetchCandidates(q);
  };

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
      <SearchBox
        id={`${id}-search`}
        label={m.rosterSearchLabel}
        placeholder={m.rosterSearchPlaceholder}
        maxLength={200}
        applied={query}
        className="max-w-none min-w-0"
        onSearch={runSearch}
      />
      <Results
        search={search}
        onSelect={(record) => {
          openDialog({ record });
        }}
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
        busy={command.busy}
        error={command.error}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onConfirm={() => {
          if (selected) void resolve(selected.id, m.identified(selected.fullName));
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

function Results({
  search,
  onSelect,
}: {
  search: Search;
  onSelect: (record: RosterCandidate) => void;
}) {
  if (search.state === 'idle') return null;
  if (search.state === 'searching') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        {m.searching}
      </p>
    );
  }
  const { result } = search;
  if (!result.ok) {
    return (
      <Alert variant="destructive" role="status">
        <Icon icon={AlertCircleIcon} />
        <AlertDescription>{m.rosterSearchFailed}</AlertDescription>
      </Alert>
    );
  }
  if (result.data.items.length === 0) {
    return (
      <div role="status">
        <Muted>{m.noRosterMatch}</Muted>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label={m.rosterResults}>
      {result.data.items.map((record) => (
        <li key={record.id} className="flex items-center gap-3 rounded-lg border px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium">{record.fullName}</div>
            <div className="text-[13px] text-muted-foreground">
              {[m.fileNumber(record.personnelFileNumber), record.designation]
                .filter(Boolean)
                .join(' · ')}
            </div>
            {record.reportingEntity ? (
              <div
                className="truncate text-[13px] text-muted-foreground"
                title={record.reportingEntity}
              >
                {record.reportingEntity}
              </div>
            ) : null}
            {!record.onboarded ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="warning">{m.notOnboarded}</Badge>
                <span className="text-xs text-muted-foreground">{m.notOnboardedHint}</span>
              </div>
            ) : null}
          </div>
          {record.onboarded ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={m.selectRecord(record.fullName)}
              onClick={() => {
                onSelect(record);
              }}
            >
              {m.select}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
