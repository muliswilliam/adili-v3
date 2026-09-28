// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_DEBOUNCE_MS, SearchBox } from './search-box';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderBox(onSearch: (value: string) => void, applied = '') {
  const props = { id: 'q', label: 'Search', placeholder: 'Search', maxLength: 50, applied };
  const view = render(<SearchBox {...props} onSearch={onSearch} />);
  return {
    input: screen.getByLabelText('Search'),
    rerender: (next: { onSearch?: (value: string) => void; applied?: string }) => {
      view.rerender(
        <SearchBox
          {...props}
          applied={next.applied ?? applied}
          onSearch={next.onSearch ?? onSearch}
        />,
      );
    },
  };
}

describe('SearchBox', () => {
  it('searches 300 ms after the last keystroke, trimmed', () => {
    const onSearch = vi.fn();
    const { input } = renderBox(onSearch);

    fireEvent.change(input, { target: { value: 'wan' } });
    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
    fireEvent.change(input, { target: { value: ' wanjiru ' } });
    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
    expect(onSearch).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(50));
    expect(onSearch).toHaveBeenCalledExactlyOnceWith('wanjiru');
  });

  it('keeps the timer running across re-renders, then calls the latest onSearch', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const { input, rerender } = renderBox(first);

    fireEvent.change(input, { target: { value: 'kip' } });
    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
    rerender({ onSearch: latest });
    act(() => void vi.advanceTimersByTime(50));

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith('kip');
  });

  it('does not search again for the text already applied', () => {
    const onSearch = vi.fn();
    const { input, rerender } = renderBox(onSearch);
    fireEvent.change(input, { target: { value: 'kip' } });
    rerender({ applied: 'kip' });

    act(() => void vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));

    expect(onSearch).not.toHaveBeenCalled();
  });
});
