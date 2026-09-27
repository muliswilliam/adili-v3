import { Button, Icon, Input } from '@adili/ui';
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import {
  COMMISSION_TYPES,
  type CommissionFilters,
  hasFilters,
  REPORTING_OFFICER_FILTERS,
} from '../../lib/commission-filters';
import { NativeSelect } from '../native-select';
import { messages } from './messages';

const SEARCH_DEBOUNCE_MS = 300;

export interface CommissionsToolbarProps {
  filters: CommissionFilters;
  onChange: (next: CommissionFilters) => void;
  /** While the directory refuses the list (403) there is nothing to filter. */
  disabled?: boolean;
}

/** The option matching a select's value, or undefined for "any". */
function pick<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => option === value);
}

/**
 * One row at the top of the list card: search (debounced, or on Enter or blur), type and
 * reporting-officer filters with visually hidden labels, and Clear while any filter is set.
 */
export function CommissionsToolbar({
  filters,
  onChange,
  disabled = false,
}: CommissionsToolbarProps) {
  const id = useId();
  const [search, setSearch] = useState(filters.search ?? '');
  const [urlSearch, setUrlSearch] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The debounce fires after later renders; it must build on the filters as they are then, not
  // as they were when the user typed.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  }, [filters]);

  // Follow the URL when it changes elsewhere ("Clear", back/forward), but keep what the user is
  // typing when the URL only caught up with it.
  if (filters.search !== urlSearch) {
    setUrlSearch(filters.search);
    if ((search.trim() || undefined) !== filters.search) setSearch(filters.search ?? '');
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  /** Applies a change, with whatever is typed in the search box committed alongside it. */
  function commit(change: Partial<CommissionFilters>, typed = search) {
    clearTimeout(timer.current);
    const next = { ...latest.current, search: typed.trim() || undefined, ...change };
    latest.current = next;
    onChange(next);
  }

  function submitSearch(value: string) {
    clearTimeout(timer.current);
    if ((value.trim() || undefined) !== latest.current.search) commit({}, value);
  }

  return (
    <div role="search" className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
      <div className="relative max-w-[360px] min-w-[220px] flex-1">
        <label htmlFor={`${id}-search`} className="sr-only">
          {messages.filters.search}
        </label>
        <Icon
          icon={Search01Icon}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          id={`${id}-search`}
          type="search"
          value={search}
          placeholder={messages.filters.searchPlaceholder}
          maxLength={100}
          disabled={disabled}
          className="h-9 pl-9 text-sm"
          onChange={(event) => {
            const value = event.target.value;
            setSearch(value);
            clearTimeout(timer.current);
            timer.current = setTimeout(() => {
              submitSearch(value);
            }, SEARCH_DEBOUNCE_MS);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitSearch(search);
          }}
          onBlur={() => {
            submitSearch(search);
          }}
        />
      </div>
      <label htmlFor={`${id}-type`} className="sr-only">
        {messages.filters.type}
      </label>
      <NativeSelect
        id={`${id}-type`}
        size="sm"
        disabled={disabled}
        value={filters.type ?? ''}
        onChange={(event) => {
          commit({ type: pick(COMMISSION_TYPES, event.target.value) });
        }}
      >
        <option value="">{messages.filters.anyType}</option>
        {COMMISSION_TYPES.map((type) => (
          <option key={type} value={type}>
            {messages.type[type]}
          </option>
        ))}
      </NativeSelect>
      <label htmlFor={`${id}-officer`} className="sr-only">
        {messages.filters.reportingOfficer}
      </label>
      <NativeSelect
        id={`${id}-officer`}
        size="sm"
        disabled={disabled}
        value={filters.reportingOfficer ?? ''}
        onChange={(event) => {
          commit({ reportingOfficer: pick(REPORTING_OFFICER_FILTERS, event.target.value) });
        }}
      >
        <option value="">{messages.filters.anyReportingOfficer}</option>
        {REPORTING_OFFICER_FILTERS.map((state) => (
          <option key={state} value={state}>
            {messages.officerState[state]}
          </option>
        ))}
      </NativeSelect>
      {hasFilters(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearTimeout(timer.current);
            setSearch('');
            latest.current = {};
            onChange({});
          }}
        >
          <Icon icon={Cancel01Icon} />
          {messages.filters.clear}
        </Button>
      ) : null}
    </div>
  );
}
