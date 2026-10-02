import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  FieldError,
  Icon,
  RadioCard,
  RadioGroup,
  Spinner,
} from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { RosterCandidate, RosterCandidates } from '../../server/access/types';
import type { ServiceResult } from '../../server/service-call';
import { SearchBox } from '../search-box';
import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { Muted } from './muted';

type Found = ServiceResult<RosterCandidates, { type: string; title: string; status: number }>;

type Search =
  | { state: 'idle' }
  | { state: 'searching'; q: string }
  | { state: 'done'; q: string; result: Found };

/** How a picker offers the records it found: a Select button each, or radio cards. */
type Choice =
  | { kind: 'select'; onSelect: (record: RosterCandidate) => void }
  | {
      kind: 'radio';
      name: string;
      selected: string | null;
      error?: ReactNode;
      onSelect: (record: RosterCandidate) => void;
    };

export interface RosterCandidatePickerProps {
  id: string;
  /** Searches the Commission's roster (a server function), at least 2 characters. */
  find: (q: string) => Promise<Found>;
  /** Searched for at once, e.g. the file number the request gives. */
  prefill?: string;
  choice: Choice;
  /** What a record that has not onboarded means on this screen, in its words. */
  notOnboardedHint: string;
  /**
   * A record that has not onboarded can be chosen too (spec 10 decision 2: its officer is told
   * in writing); otherwise it is marked and cannot be chosen.
   */
  allowNotOnboarded?: boolean;
  /** Show the record's reporting entity under its file number. */
  withEntity?: boolean;
}

/**
 * Finds an officer on the Commission's roster by name or personnel file number (spec 10: the
 * officer Form K names, the officer a law enforcement request seeks, the declarant applying for
 * a certified copy). Only the latest search's answer shows; searching, no match and a failed
 * search are said; a record that has not onboarded is marked, and cannot be chosen unless
 * `allowNotOnboarded`.
 */
export function RosterCandidatePicker({
  id,
  find,
  prefill = '',
  choice,
  notOnboardedHint,
  allowNotOnboarded = false,
  withEntity = false,
}: RosterCandidatePickerProps) {
  const initial = prefill.trim();
  const [query, setQuery] = useState(initial);
  const [search, setSearch] = useState<Search>(() =>
    initial.length >= 2 ? { state: 'searching', q: initial } : { state: 'idle' },
  );
  const latest = useRef(0);

  const fetchCandidates = (q: string) => {
    const ticket = ++latest.current;
    void find(q)
      .catch((): Found => ({ ok: false, error: { kind: 'unavailable', detail: null } }))
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
    if (initial.length >= 2) fetchCandidates(initial);
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

  return (
    <>
      <SearchBox
        id={id}
        label={m.rosterSearchLabel}
        placeholder={m.rosterSearchPlaceholder}
        maxLength={200}
        applied={query}
        className="max-w-none min-w-0"
        onSearch={runSearch}
      />
      <Results
        search={search}
        choice={choice}
        notOnboardedHint={notOnboardedHint}
        allowNotOnboarded={allowNotOnboarded}
        withEntity={withEntity}
      />
      {/* With no records to choose from, a missing choice is said under the search. */}
      {choice.kind === 'radio' && choice.error && !hasRecords(search) ? (
        <FieldError id={`${id}-error`}>{choice.error}</FieldError>
      ) : null}
    </>
  );
}

function hasRecords(search: Search): boolean {
  return search.state === 'done' && search.result.ok && search.result.data.items.length > 0;
}

function Results({
  search,
  choice,
  notOnboardedHint,
  allowNotOnboarded,
  withEntity,
}: {
  search: Search;
  choice: Choice;
  notOnboardedHint: string;
  allowNotOnboarded: boolean;
  withEntity: boolean;
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

  const details = (record: RosterCandidate) => (
    <>
      <span className="block text-[13px] text-muted-foreground">
        {[m.fileNumber(record.personnelFileNumber), record.designation].filter(Boolean).join(' · ')}
      </span>
      {withEntity && record.reportingEntity ? (
        <span className="block text-[13px] text-muted-foreground">{record.reportingEntity}</span>
      ) : null}
      {record.onboarded ? null : (
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge variant="warning">{m.notOnboarded}</Badge>
          <span className="text-xs text-muted-foreground">{notOnboardedHint}</span>
        </span>
      )}
    </>
  );

  if (choice.kind === 'radio') {
    return (
      <RadioGroup legend={m.rosterResults} legendHidden error={choice.error}>
        {result.data.items.map((record) => (
          <RadioCard
            key={record.id}
            name={choice.name}
            value={record.id}
            label={record.fullName}
            description={details(record)}
            checked={choice.selected === record.id}
            disabled={!record.onboarded && !allowNotOnboarded}
            onChange={() => {
              choice.onSelect(record);
            }}
          />
        ))}
      </RadioGroup>
    );
  }

  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label={m.rosterResults}>
      {result.data.items.map((record) => (
        <li key={record.id} className="flex items-center gap-3 rounded-lg border px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium">{record.fullName}</div>
            {details(record)}
          </div>
          {record.onboarded || allowNotOnboarded ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={m.selectRecord(record.fullName)}
              onClick={() => {
                choice.onSelect(record);
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
