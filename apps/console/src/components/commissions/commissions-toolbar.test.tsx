// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommissionFilters } from '../../lib/commission-filters';
import { CommissionsToolbar } from './commissions-toolbar';

/** The toolbar as the list route uses it: every change becomes the new URL filters. */
function Harness({ onChange }: { onChange: (next: CommissionFilters) => void }) {
  const [filters, setFilters] = useState<CommissionFilters>({});
  return (
    <CommissionsToolbar
      filters={filters}
      onChange={(next) => {
        onChange(next);
        setFilters(next);
      }}
    />
  );
}

const searchBox = () => screen.getByRole('searchbox', { name: 'Search Commissions' });
const typeFilter = () => screen.getByRole('combobox', { name: 'Type' });
const officerFilter = () => screen.getByRole('combobox', { name: 'Reporting officer' });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('CommissionsToolbar', () => {
  it('submits the search 300 ms after typing stops', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(searchBox(), { target: { value: 'ken' } });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenLastCalledWith({ search: 'ken' });
  });

  it('keeps a filter picked while the search is still debouncing', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(searchBox(), { target: { value: 'ken' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(typeFilter(), { target: { value: 'federated' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenLastCalledWith({ search: 'ken', type: 'federated' });
    expect(searchBox()).toHaveProperty('value', 'ken');
    expect(typeFilter()).toHaveProperty('value', 'federated');
  });

  it('commits the typed search together with a picked filter, once', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(searchBox(), { target: { value: 'ken' } });
    fireEvent.change(officerFilter(), { target: { value: 'none' } });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ search: 'ken', reportingOfficer: 'none' });
  });

  it('offers the contract values for each filter', () => {
    render(<Harness onChange={vi.fn()} />);
    const values = (select: HTMLElement) =>
      Array.from(select.querySelectorAll('option'), (option) => option.value);
    expect(values(typeFilter())).toEqual(['', 'hosted', 'federated']);
    expect(values(officerFilter())).toEqual(['', 'none', 'invited', 'activated']);
  });
});
