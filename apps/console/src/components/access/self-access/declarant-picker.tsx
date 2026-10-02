import { Alert, AlertDescription, Badge, Button, FieldError, Icon, Spinner } from '@adili/ui';
import { AlertCircleIcon } from '@hugeicons/core-free-icons';
import { useRef, useState } from 'react';

import type { RosterCandidate, RosterCandidates } from '../../../server/access/types';
import { findDeclarants } from '../../../server/self-access';
import type { SelfAccessResult } from '../../../server/self-access.server';
import { SearchBox } from '../../search-box';
import { initials } from '../../shell/nav';
import { goToSignIn } from '../../sign-in-redirect';
import { messages as m } from './messages';

type Search =
  | { state: 'idle' }
  | { state: 'searching'; q: string }
  | { state: 'done'; q: string; result: SelfAccessResult<RosterCandidates> };

/**
 * The declarant, found on the Commission's roster by name or personnel file number. Only an
 * onboarded record can be chosen: without a declarant account there is no declaration to copy.
 * Once chosen it shows as a card with Change.
 */
export function DeclarantPicker({
  id,
  slug,
  selected,
  error,
  onSelect,
}: {
  id: string;
  slug: string;
  selected: RosterCandidate | null;
  error?: string;
  onSelect: (record: RosterCandidate | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  // Only the latest search's answer is shown.
  const latest = useRef(0);

  const runSearch = (value: string) => {
    const q = value.trim();
    setQuery(q);
    const ticket = ++latest.current;
    if (q.length < 2) {
      setSearch({ state: 'idle' });
      return;
    }
    setSearch({ state: 'searching', q });
    void findDeclarants({ data: { slug, q } })
      .catch((): SelfAccessResult<RosterCandidates> => ({
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

  if (selected) {
    return (
      <div className="flex items-center gap-3 rounded-lg border px-3.5 py-3">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-brand/45 to-brand text-[12px] font-semibold text-primary-foreground"
        >
          {initials(selected.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{selected.fullName}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            {[
              m.fileNumber(selected.personnelFileNumber),
              selected.designation,
              selected.reportingEntity,
            ]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={m.changeDeclarant}
          onClick={() => {
            onSelect(null);
          }}
        >
          {m.change}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2.5">
      <SearchBox
        id={id}
        label={m.rosterSearchLabel}
        placeholder={m.rosterSearchPlaceholder}
        maxLength={200}
        applied={query}
        className="max-w-none min-w-0"
        onSearch={runSearch}
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      <Results
        search={search}
        onSelect={(record) => {
          onSelect(record);
        }}
      />
    </div>
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
      <p
        role="status"
        className="rounded-lg bg-muted px-3.5 py-3 text-sm text-secondary-foreground"
      >
        {m.noRosterMatch}
      </p>
    );
  }
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label={m.rosterResults}>
      {result.data.items.map((record) => (
        <li key={record.id} className="flex items-center gap-3 rounded-lg border px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium">{record.fullName}</div>
            <div className="truncate text-[13px] text-muted-foreground">
              {[m.fileNumber(record.personnelFileNumber), record.designation]
                .filter(Boolean)
                .join(' · ')}
            </div>
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
