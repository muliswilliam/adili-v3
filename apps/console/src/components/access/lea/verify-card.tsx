import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  CheckboxItem,
  FieldError,
  formatDate,
  FormField,
  Icon,
  Spinner,
  Textarea,
  useToast,
} from '@adili/ui';
import {
  AlertCircleIcon,
  CheckmarkCircle02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { Link, useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect, useEffectEvent, useId, useRef, useState } from 'react';

import type { AccessResult } from '../../../server/access-requests.server';
import type { LeaRequest, RosterCandidate, RosterCandidates } from '../../../server/access/types';
import { findLeaRosterCandidates, verifyLea } from '../../../server/lea-requests';
import { SearchBox } from '../../search-box';
import { goToSignIn } from '../../sign-in-redirect';
import { Muted, SideCard } from '../side-cards';
import { leaActionFailure, leaNoteError } from './lea-view';
import { messages as m } from './messages';

type Search =
  | { state: 'idle' }
  | { state: 'searching'; q: string }
  | { state: 'done'; q: string; result: AccessResult<RosterCandidates> };

interface Errors {
  provenance?: string;
  reason?: string;
  record?: string;
  note?: string;
}

/**
 * "Verify" (S11, Regs r.23(1)): the access officer confirms the request comes from the agency
 * account it shows and states its reason, finds the officer sought on the Commission's roster
 * (an onboarded record: their declarant is told after a grant) and notes what they checked. A
 * request that cannot be verified is denied instead.
 */
export function LeaVerifyCard({ request }: { request: LeaRequest }) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const sought = request.officerSought;
  const prefill = (sought.personnelFileNumber ?? sought.name).trim();
  const [provenance, setProvenance] = useState(false);
  const [reason, setReason] = useState(false);
  const [query, setQuery] = useState(prefill);
  const [search, setSearch] = useState<Search>(() =>
    prefill.length >= 2 ? { state: 'searching', q: prefill } : { state: 'idle' },
  );
  const [record, setRecord] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  // Only the latest search's answer is shown.
  const latest = useRef(0);

  const fetchCandidates = (q: string) => {
    const ticket = ++latest.current;
    void findLeaRosterCandidates({ data: { requestId: request.id, q } })
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
    const result = await verifyLea({
      data: {
        requestId: request.id,
        rosterRecordId: record,
        note: note.trim(),
        idempotencyKey: key,
      },
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
        <SearchBox
          id={`${id}-search`}
          label={m.rosterSearchLabel}
          placeholder={m.rosterSearchPlaceholder}
          maxLength={200}
          applied={query}
          className="max-w-none min-w-0"
          onSearch={runSearch}
        />
        <Hits
          name={`${id}-record`}
          search={search}
          selected={record}
          error={errors.record}
          onSelect={(candidate) => {
            setRecord(candidate.id);
            if (errors.record) setErrors({ ...errors, record: undefined });
          }}
        />
        {errors.record ? <FieldError id={`${id}-record-error`}>{errors.record}</FieldError> : null}
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

function Hits({
  name,
  search,
  selected,
  error,
  onSelect,
}: {
  name: string;
  search: Search;
  selected: string | null;
  error?: string;
  onSelect: (candidate: RosterCandidate) => void;
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
    <div
      role="radiogroup"
      aria-label={m.rosterMatches}
      aria-invalid={error ? true : undefined}
      className="grid grid-cols-[minmax(0,1fr)] gap-2"
    >
      {result.data.items.map((candidate) => {
        const inputId = `${name}-${candidate.id}`;
        return (
          <label
            key={candidate.id}
            htmlFor={inputId}
            className="relative flex cursor-pointer items-start gap-3 rounded-lg bg-control px-3.5 py-3 shadow-control transition-shadow hover:shadow-control-hover has-checked:shadow-control-selected has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-3 has-focus-visible:outline-ring/15"
          >
            <input
              id={inputId}
              type="radio"
              name={name}
              value={candidate.id}
              checked={selected === candidate.id}
              disabled={!candidate.onboarded}
              onChange={() => {
                onSelect(candidate);
              }}
              className="peer pointer-events-none absolute opacity-0"
            />
            <span
              aria-hidden="true"
              className="mt-0.5 size-[18px] shrink-0 rounded-full bg-control shadow-[inset_0_0_0_1.5px_var(--input)] transition-shadow peer-checked:shadow-[inset_0_0_0_5px_var(--primary)]"
            />
            <span className="grid min-w-0 gap-0.5">
              <span className="text-[14.5px] font-medium">{candidate.fullName}</span>
              <span className="text-[13px] text-muted-foreground">
                {[m.fileNumber(candidate.personnelFileNumber), candidate.designation]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {candidate.reportingEntity ? (
                <span className="truncate text-[13px] text-muted-foreground">
                  {candidate.reportingEntity}
                </span>
              ) : null}
              {!candidate.onboarded ? (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="warning">{m.notOnboarded}</Badge>
                  <span className="text-xs text-muted-foreground">{m.notOnboardedHint}</span>
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
