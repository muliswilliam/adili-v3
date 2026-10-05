// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PersonSummary } from '../../server/support/types';
import { messages as t } from './messages';
import { PersonLookupForm, PersonLookupResult } from './person-lookup';

vi.mock('../../server/account-support', () => ({ OFR_PATTERN: /^OFR-[0-9]{7}-[0-9A-Z]$/ }));

const person: PersonSummary = {
  personId: '7d3f9b2a-4c1e-4f8a-9b6d-2e5a1c3f7b90',
  ofr: 'OFR-0001042-J',
  fullName: 'Wanjiku Njoki Kamau',
  commissions: ['psc', 'tsc'],
  contactsOnFile: { email: true, phone: false },
  createdAt: '2026-09-28T07:41:12.000Z',
};

describe('PersonLookupForm', () => {
  it('looks up the reference upper-cased and trimmed', () => {
    const onLookUp = vi.fn();
    render(<PersonLookupForm applied={undefined} onLookUp={onLookUp} />);
    fireEvent.change(screen.getByLabelText(t.search.field), {
      target: { value: ' ofr-0001042-j ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t.search.submit }));
    expect(onLookUp).toHaveBeenCalledWith('OFR-0001042-J');
  });

  it('does not search a malformed reference and says what one looks like', () => {
    const onLookUp = vi.fn();
    render(<PersonLookupForm applied={undefined} onLookUp={onLookUp} />);
    fireEvent.change(screen.getByLabelText(t.search.field), { target: { value: '27451863' } });
    fireEvent.click(screen.getByRole('button', { name: t.search.submit }));
    expect(onLookUp).not.toHaveBeenCalled();
    expect(screen.getByText(t.search.invalid)).toBeTruthy();
  });
});

describe('PersonLookupResult', () => {
  it('shows the account: Commissions and which contacts are on file, never the contacts', () => {
    render(
      <ToastProvider>
        <PersonLookupResult result={{ ok: true, data: person }} />
      </ToastProvider>,
    );
    expect(screen.getByText('Wanjiku Njoki Kamau')).toBeTruthy();
    expect(screen.getByText('PSC')).toBeTruthy();
    expect(screen.getByText('TSC')).toBeTruthy();
    expect(screen.getByText(t.result.onFile)).toBeTruthy();
    expect(screen.getByText(t.result.notOnFile)).toBeTruthy();
  });

  it.each([
    [404, t.notFound.title],
    [400, t.mistyped.title],
    [403, t.forbidden.title],
  ])('explains a %i', (status, title) => {
    render(
      <PersonLookupResult
        result={{
          ok: false,
          error: { kind: 'problem', problem: { type: 'about:blank', title: 'x', status } },
        }}
      />,
    );
    expect(screen.getByText(title)).toBeTruthy();
  });

  it('asks to try again when the directory is unreachable', () => {
    render(
      <PersonLookupResult result={{ ok: false, error: { kind: 'unavailable', detail: null } }} />,
    );
    expect(screen.getByText(t.unavailable.title)).toBeTruthy();
  });
});
