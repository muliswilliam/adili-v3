import { Button, Icon, Input } from '@adili/ui';
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { useEffect, useId, useRef, useState } from 'react';

import { NativeSelect } from '../native-select';
import { type CommissionFilters, hasFilters } from './filters';
import { messages } from './messages';

const SEARCH_DEBOUNCE_MS = 300;

export interface CommissionsToolbarProps {
  filters: CommissionFilters;
  onChange: (next: CommissionFilters) => void;
  /** While the directory refuses the list (403) there is nothing to filter. */
  disabled?: boolean;
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

  function submitSearch(value: string) {
    clearTimeout(timer.current);
    const next = value.trim() || undefined;
    if (next !== filters.search) onChange({ ...filters, search: next });
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
          const value = event.target.value;
          onChange({
            ...filters,
            type: value === 'hosted' || value === 'federated' ? value : undefined,
          });
        }}
      >
        <option value="">{messages.filters.anyType}</option>
        <option value="hosted">{messages.type.hosted}</option>
        <option value="federated">{messages.type.federated}</option>
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
          const value = event.target.value;
          onChange({
            ...filters,
            reportingOfficer:
              value === 'none' || value === 'invited' || value === 'activated' ? value : undefined,
          });
        }}
      >
        <option value="">{messages.filters.anyReportingOfficer}</option>
        <option value="none">{messages.officerState.none}</option>
        <option value="invited">{messages.officerState.invited}</option>
        <option value="activated">{messages.officerState.activated}</option>
      </NativeSelect>
      {hasFilters(filters) ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearTimeout(timer.current);
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
