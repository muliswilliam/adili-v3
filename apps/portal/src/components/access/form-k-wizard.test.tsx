// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DECLARATION_TEXT } from '../../access/form-k';
import type { Applicant } from '../../server/access-requests.server';
import type { AccessCommission } from '../../server/access/types';
import { FormKWizard, type SubmitFormK } from './form-k-wizard';
import { NOW } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../sign-in', () => ({ signInAgain: vi.fn() }));

const APPLICANT: Applicant = {
  name: 'Mercy Wanjiku Kamau',
  identityDocument: { kind: 'national-id', number: '28841276', country: null },
  identityStatus: 'verified',
  telephone: '+254722418903',
  email: 'mercy.kamau@example.com',
};

const COMMISSIONS: AccessCommission[] = [
  { slug: 'cpsb022', name: 'Kiambu County Public Service Board', years: [] },
  { slug: 'psc', name: 'Public Service Commission', years: [2025, 2026] },
];

beforeEach(() => {
  window.scrollTo = vi.fn() as typeof window.scrollTo;
});

function start(submit: SubmitFormK = vi.fn<SubmitFormK>(), applicant = APPLICANT) {
  const onSubmitted = vi.fn();
  render(
    <FormKWizard
      applicant={applicant}
      commissions={COMMISSIONS}
      now={NOW}
      submit={submit}
      onSubmitted={onSubmitted}
    />,
  );
  return { onSubmitted };
}

const heading = () => screen.getByRole('heading', { level: 1 }).textContent;
const next = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
};
const type = (label: string | RegExp, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

function chooseCommission(name: string) {
  fireEvent.change(screen.getByRole('combobox'), { target: { value: name.slice(0, 6) } });
  fireEvent.click(screen.getByRole('option', { name }));
}

/** Fills every step and stops on Check and declare. */
function fillAll() {
  chooseCommission('Public Service Commission');
  next();
  type('Postal address', 'P.O. Box 49010-00100, Nairobi');
  type('Physical address', 'Othaya Road, Kileleshwa, Nairobi');
  type('Occupation', 'Journalist');
  next();
  type('Name', 'Peter Mwangi Kamau');
  type(/^Entity/, 'State Department for Housing and Urban Development');
  next();
  type('Information you want', 'Assets declared in the 2026 initial declaration.');
  type(/^Reason for requiring it/, 'The officer approved housing tenders to a linked company.');
  next();
  fireEvent.click(screen.getByLabelText('2026'));
  fireEvent.click(screen.getByLabelText('Assets'));
  next();
}

describe('FormKWizard (S17)', () => {
  it('asks for the Commission before moving on', () => {
    start();
    expect(heading()).toBe('Which Commission?');
    next();
    expect(screen.getByText('Choose the Commission.')).toBeTruthy();
    expect(heading()).toBe('Which Commission?');
  });

  it('stops at a Commission with no declarations yet', () => {
    start();
    chooseCommission('Kiambu County Public Service Board');
    expect(
      screen.getByText(
        'No declarations are available from Kiambu County Public Service Board yet. Try again after its first declaration period.',
      ),
    ).toBeTruthy();
    next();
    expect(heading()).toBe('Which Commission?');
  });

  it('pre-fills Part I from the account, leaving addresses and occupation to the applicant', () => {
    start();
    chooseCommission('Public Service Commission');
    next();
    expect(heading()).toBe('Your particulars');
    expect(screen.getByText('Mercy Wanjiku Kamau')).toBeTruthy();
    expect(screen.getByText('28841276')).toBeTruthy();
    expect(screen.getByText('+254 722 418 903')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    next();
    expect(screen.getByText('Enter your postal address.')).toBeTruthy();
    expect(screen.getByText('Enter your physical address.')).toBeTruthy();
    expect(screen.getByText('Enter your occupation.')).toBeTruthy();
  });

  it('marks a passport as checked by the Commission', () => {
    start(vi.fn<SubmitFormK>(), {
      ...APPLICANT,
      identityDocument: { kind: 'passport', number: 'G2847193', country: 'GH' },
      identityStatus: 'pending-verification',
    });
    chooseCommission('Public Service Commission');
    next();
    expect(screen.getByText('Passport (GH)')).toBeTruthy();
    expect(screen.getByText('Checked by the Commission')).toBeTruthy();
  });

  it('counts long answers and refuses ones that are too short or too long', () => {
    start();
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: 'Information sought' }));
    type('Information you want', 'Assets');
    type(/^Reason for requiring it/, 'x'.repeat(4001));
    next();
    expect(
      screen.getByText('Describe the information you want (at least 10 characters).'),
    ).toBeTruthy();
    expect(screen.getByText('Keep this to 4,000 characters or fewer.')).toBeTruthy();
    expect(screen.getByText('4,001 / 4,000')).toBeTruthy();
  });

  it('asks for a year and a section in the scope', () => {
    start();
    fillAll();
    fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
    fireEvent.click(screen.getByLabelText('2026'));
    fireEvent.click(screen.getByLabelText('Assets'));
    next();
    expect(screen.getByText('Choose at least one declaration year.')).toBeTruthy();
    expect(screen.getByText('Choose at least one section.')).toBeTruthy();
  });

  it('S2: reviews the form, needs the declaration, then submits once', async () => {
    const submit = vi
      .fn<SubmitFormK>()
      .mockResolvedValue({ status: 'submitted', id: 'r1', reference: 'ARQ-PSC-2026-0000160-U' });
    const { onSubmitted } = start(submit);
    fillAll();
    expect(heading()).toBe('Check and declare');
    expect(screen.getAllByText('Public Service Commission').length).toBeGreaterThan(0);
    expect(screen.getByText('Peter Mwangi Kamau')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit Officer sought' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(screen.getByText('Tick the declaration to submit your request.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(DECLARATION_TEXT));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await vi.waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith({ id: 'r1', reference: 'ARQ-PSC-2026-0000160-U' });
    });
    const [input] = submit.mock.calls[0] ?? [];
    expect(input?.draft).toMatchObject({
      commission: 'psc',
      occupation: 'Journalist',
      officer: { name: 'Peter Mwangi Kamau', workStation: '', personnelFileNumber: '' },
      scope: { years: [2026], sections: ['assets'] },
      declared: true,
    });
  });

  it('S2: opens the step the service refused, with the field marked', async () => {
    const submit = vi.fn<SubmitFormK>().mockResolvedValue({
      status: 'invalid',
      steps: ['officer'],
      errors: { 'officer.name': 'Enter the officer’s full name.' },
    });
    start(submit);
    fillAll();
    fireEvent.click(screen.getByLabelText(DECLARATION_TEXT));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Your request was not submitted.')).toBeTruthy();
    expect(heading()).toBe('Officer sought');
    expect(screen.getByText('Enter the officer’s full name.')).toBeTruthy();
    type('Name', 'Peter Kamau');
    expect(screen.queryByText('Enter the officer’s full name.')).toBeNull();
  });

  it('keeps the answers when the service is down, and retries with the same key', async () => {
    const submit = vi.fn<SubmitFormK>().mockResolvedValue({ status: 'unavailable' });
    start(submit);
    fillAll();
    fireEvent.click(screen.getByLabelText(DECLARATION_TEXT));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(
      await screen.findByText(
        'We could not reach the Commission’s service. Your answers are still here: try again in a few minutes.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await vi.waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(2);
    });
    expect(submit.mock.calls[1]?.[0].idempotencyKey).toBe(submit.mock.calls[0]?.[0].idempotencyKey);
  });

  it('submitting from an unfinished form opens the first step that needs attention', () => {
    const submit = vi.fn<SubmitFormK>();
    start(submit);
    fireEvent.click(screen.getByRole('button', { name: 'Declare' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(heading()).toBe('Which Commission?');
    expect(screen.getByText('Choose the Commission.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
});
