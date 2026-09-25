import { FormField, Input } from '@adili/ui';
import { useEffect, useRef, useState } from 'react';

import { NativeSelect } from '../native-select';
import type { CommissionFilters } from './filters';
import { messages } from './messages';

const SEARCH_DEBOUNCE_MS = 300;

export interface CommissionsToolbarProps {
  filters: CommissionFilters;
  onChange: (next: CommissionFilters) => void;
}

/** Search (debounced, or on Enter or blur) plus type and reporting-officer filters. */
export function CommissionsToolbar({ filters, onChange }: CommissionsToolbarProps) {
  const [search, setSearch] = useState(filters.search ?? '');
  const [urlSearch, setUrlSearch] = useState(filters.search);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Follow the URL when it changes elsewhere ("Clear filters", back/forward), but keep what the
  // user is typing when the URL only caught up with it.
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
    <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <FormField label={messages.filters.search}>
        <Input
          type="search"
          value={search}
          placeholder={messages.filters.searchPlaceholder}
          maxLength={100}
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
      </FormField>
      <FormField label={messages.filters.type}>
        <NativeSelect
          value={filters.type ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filters,
              type: value === 'hosted' || value === 'federated' ? value : undefined,
            });
          }}
        >
          <option value="">{messages.filters.any}</option>
          <option value="hosted">{messages.type.hosted}</option>
          <option value="federated">{messages.type.federated}</option>
        </NativeSelect>
      </FormField>
      <FormField label={messages.filters.reportingOfficer}>
        <NativeSelect
          value={filters.reportingOfficer ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filters,
              reportingOfficer:
                value === 'none' || value === 'invited' || value === 'activated'
                  ? value
                  : undefined,
            });
          }}
        >
          <option value="">{messages.filters.any}</option>
          <option value="none">{messages.officerState.none}</option>
          <option value="invited">{messages.officerState.invited}</option>
          <option value="activated">{messages.officerState.activated}</option>
        </NativeSelect>
      </FormField>
    </div>
  );
}
