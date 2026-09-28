// @vitest-environment jsdom
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { focusControl, useFocusFirstError, useShownErrors } from './section-errors';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useShownErrors', () => {
  it('shows an error once its field is left', () => {
    const { result } = renderHook(() => useShownErrors(false));
    expect(result.current.shown('postal')).toBe(false);

    act(() => {
      result.current.touch('postal');
    });
    expect(result.current.shown('postal')).toBe(true);
    expect(result.current.shown('physical')).toBe(false);
  });

  it('shows every error with showErrors', () => {
    const { result } = renderHook(() => useShownErrors(true));
    expect(result.current.shown('anything')).toBe(true);
  });
});

describe('focusControl', () => {
  it('focuses a control, or in a group its first invalid control, else its first', () => {
    render(
      <>
        <input id="alone" />
        <fieldset id="date">
          <input aria-label="Day" />
          <input aria-label="Month" aria-invalid="true" />
        </fieldset>
        <div id="card">
          <textarea aria-label="Explanation" />
        </div>
      </>,
    );

    focusControl('alone');
    expect(document.activeElement?.id).toBe('alone');
    focusControl('date');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Month');
    focusControl('card');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Explanation');
    focusControl('missing');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Explanation');
  });
});

describe('useFocusFirstError', () => {
  function Screen({ showErrors }: { showErrors: boolean }) {
    useFocusFirstError(showErrors, () => 'second');
    return (
      <>
        <input id="first" />
        <input id="second" />
      </>
    );
  }

  it('focuses the first field to fix only when arriving with errors shown', () => {
    const { unmount } = render(<Screen showErrors={false} />);
    expect(document.activeElement).toBe(document.body);
    unmount();

    render(<Screen showErrors />);
    expect(document.activeElement?.id).toBe('second');
  });
});
