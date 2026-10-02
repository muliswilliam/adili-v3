// @vitest-environment jsdom
import { type Scope, ToastProvider, TooltipProvider } from '@adili/ui';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DecisionForm, type DecisionFormProps } from './decision-form';

const requested: Scope = {
  years: [2025, 2026],
  includeSpouses: true,
  includeChildren: true,
  sections: ['income', 'liabilities'],
  includeClarifications: true,
};

// The side cards' server functions (attachment links) are not used here.
vi.mock('../../../server/access-requests', () => ({}));

const CLARIFICATIONS = "The declarant's clarifications";

const submit = vi.fn<DecisionFormProps['submit']>();
const onDecided = vi.fn();
const onCancel = vi.fn();

function renderForm(more: Partial<DecisionFormProps> = {}) {
  render(
    <TooltipProvider>
      <ToastProvider>
        <DecisionForm
          requestedScope={requested}
          clarifications
          deadline={{ due: new Date(Date.now() + 3 * 86_400_000).toISOString(), soonDays: 10 }}
          reasonsHint="Sent to the applicant and the declarant."
          finality={() => ({ title: 'This decision is final.' })}
          packageRecipient="Mercy Wanjiku Kamau"
          submit={submit}
          onDecided={onDecided}
          onCancel={onCancel}
          {...more}
        />
      </ToastProvider>
    </TooltipProvider>,
  );
}

const choose = (outcome: string) => {
  fireEvent.click(screen.getByRole('radio', { name: outcome }));
};
const tick = (name: string) => {
  fireEvent.click(screen.getByRole('checkbox', { name }));
};
const reasons = (text: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Reasons' }), { target: { value: text } });
};
const record = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
};
const confirm = async () => {
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Record decision' }));
  return dialog;
};

beforeEach(() => {
  submit.mockReset();
  onDecided.mockReset();
  onCancel.mockReset();
});

describe('DecisionForm (#260, S6)', () => {
  it('offers Grant, Partial grant and Deny, or the outcomes given (LEA)', () => {
    renderForm();
    expect(screen.getAllByRole('radio').map((each) => each.getAttribute('value'))).toEqual([
      'grant',
      'partial-grant',
      'deny',
    ]);
  });

  it('a partial grant can only narrow the requested scope', () => {
    renderForm();
    choose('Partial grant');
    for (const name of ['Assets', 'Personal details', 'Other information']) {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name }).disabled).toBe(true);
    }
    for (const name of ['2025', '2026', 'Spouses', 'Children', 'Income', CLARIFICATIONS]) {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name }).disabled).toBe(false);
    }
    // The whole request is a grant, not a partial grant.
    for (const name of [
      '2025',
      '2026',
      'Spouses',
      'Children',
      'Income',
      'Liabilities',
      CLARIFICATIONS,
    ]) {
      tick(name);
    }
    expect(
      screen.getByText('This is the full requested scope. Choose Grant instead.'),
    ).toBeTruthy();
  });

  it('GroundsSelect quotes Regulation 24 and is required for a partial grant and a denial', () => {
    renderForm();
    choose('Grant');
    expect(screen.queryByRole('group', { name: 'Regulation 24 grounds' })).toBeNull();
    choose('Deny');
    const grounds = screen.getByRole('group', { name: 'Regulation 24 grounds' });
    expect(grounds.textContent).toContain('(c) the request is frivolous, vexatious or scandalous;');
    reasons('A private dispute.');
    record();
    expect(
      screen.getByText('Choose at least one ground for a partial grant or a denial.'),
    ).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirms finality, then records a partial grant with its scope and grounds', async () => {
    submit.mockResolvedValue({ ok: true, data: {} });
    renderForm();
    choose('Partial grant');
    tick('2026');
    tick('Spouses');
    tick('Income');
    tick('Against public interest');
    reasons('  Narrowed to what the purpose needs.  ');
    record();
    const dialog = await screen.findByRole('dialog', { name: 'Record partial grant?' });
    expect(dialog.textContent).toContain('This decision is final.');
    expect(dialog.textContent).toContain('A Confidential package goes to Mercy Wanjiku Kamau');
    expect(dialog.textContent).toContain('2026 · Officer and spouses · Income');
    expect(dialog.textContent).toContain('Grounds: Against public interest');
    await confirm();
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalled();
    });
    expect(submit).toHaveBeenCalledWith(
      {
        outcome: 'partial-grant',
        grantedScope: {
          years: [2026],
          includeSpouses: true,
          includeChildren: false,
          sections: ['income'],
          includeClarifications: false,
        },
        grounds: ['public-interest'],
        reasons: 'Narrowed to what the purpose needs.',
      },
      expect.any(String),
    );
  });

  it('a denial confirms without a package', async () => {
    submit.mockResolvedValue({ ok: true, data: {} });
    renderForm();
    choose('Deny');
    tick('Frivolous, vexatious or scandalous');
    reasons('A private dispute.');
    record();
    const dialog = await screen.findByRole('dialog', { name: 'Record denial?' });
    expect(dialog.textContent).not.toContain('Confidential package');
  });

  it('shows the server 400 by field, and retries an unchanged decision with the same key', async () => {
    submit
      .mockResolvedValueOnce({ ok: false, error: { kind: 'unavailable', detail: null } })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          kind: 'problem',
          problem: {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            code: 'grounds-required',
            errors: [{ path: 'grounds', message: 'required' }],
          },
        },
      });
    renderForm();
    choose('Deny');
    tick('Does not promote the objectives of the Act');
    reasons('No.');
    record();
    await confirm();
    expect(
      await screen.findByText(
        'The access service did not answer. Nothing was recorded. Try again.',
      ),
    ).toBeTruthy();
    record();
    await confirm();
    expect(
      await screen.findByText(
        'A partial grant or a denial needs at least one Regulation 24 ground.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Choose at least one ground for a partial grant or a denial.'),
    ).toBeTruthy();
    expect(submit.mock.calls[0]?.[1]).toBe(submit.mock.calls[1]?.[1]);

    // A changed decision is a new request to the service.
    submit.mockResolvedValueOnce({ ok: true, data: {} });
    reasons('No, changed.');
    record();
    await confirm();
    await waitFor(() => {
      expect(onDecided).toHaveBeenCalled();
    });
    expect(submit.mock.calls[2]?.[1]).not.toBe(submit.mock.calls[1]?.[1]);
  });

  it('a 409 says it was decided already and offers the request', async () => {
    submit.mockResolvedValue({
      ok: false,
      error: {
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Conflict', status: 409, code: 'request-decided' },
      },
    });
    renderForm();
    choose('Grant');
    expect(
      screen.getByText(
        'Releases the full requested scope: 2025, 2026 · Officer, spouses and children · Income, liabilities, clarifications.',
      ),
    ).toBeTruthy();
    reasons('Yes.');
    record();
    await confirm();
    expect(await screen.findByText('Already decided')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open the request' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('offers no partial grant when nothing can be left out', () => {
    renderForm({
      requestedScope: {
        years: [2026],
        includeSpouses: false,
        includeChildren: false,
        sections: ['assets'],
        includeClarifications: false,
      },
    });
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Partial grant' }).disabled).toBe(
      true,
    );
    expect(
      screen.getByText('Nothing to leave out: one year and one section were requested.'),
    ).toBeTruthy();
  });

  it('LEA: Grant and Deny only', () => {
    renderForm({ outcomes: ['grant', 'deny'] });
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('a partial grant can leave out the clarifications asked for, and can never add them', () => {
    renderForm({ requestedScope: { ...requested, includeClarifications: false } });
    choose('Partial grant');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: CLARIFICATIONS }).disabled).toBe(
      true,
    );
  });

  it('offers no clarifications when the request cannot cover them (law enforcement)', () => {
    renderForm({
      clarifications: false,
      requestedScope: { ...requested, includeClarifications: false },
    });
    choose('Partial grant');
    expect(screen.queryByRole('group', { name: 'Clarifications' })).toBeNull();
  });
});
