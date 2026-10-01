// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { discardMyAmendment } from '../../server/declarations';
import type { LoadedSummary } from '../../server/declarations.server';
import type { CompletenessIssue, SubmissionResult } from '../../server/declarations/types';
import { getStepUpStatus } from '../../server/step-up';
import { submitMyDeclaration } from '../../server/submission';
import type { SubmitOutcome } from '../../server/submission.server';
import { signInAgain, stepUp } from '../sign-in';
import { SummaryView } from './summary-view';
import {
  DECLARATION_ID,
  renderWorkspace,
  sampleDeclaration,
  sections,
  workspaceTree,
} from './testing';
import { invalidate, navigate } from './testing-mocks';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());
vi.mock('../../server/submission', async () => (await import('./testing-mocks')).submissionMock());
vi.mock('../../server/step-up', async () => (await import('./testing-mocks')).stepUpMock());
vi.mock('../sign-in', () => ({ stepUp: vi.fn(), signInAgain: vi.fn(), loginHref: vi.fn() }));

const submitMock = vi.mocked(submitMyDeclaration);
const stepUpStatusMock = vi.mocked(getStepUpStatus);
const stepUpMock = vi.mocked(stepUp);

const ATTESTATION =
  'I solemnly declare that the information I have given in this declaration is, to the best of my knowledge, true and complete.';
const SUMMARY_PATH = `/declarations/${DECLARATION_ID}/summary`;
// 10:42 in Nairobi.
const AUTH_TIME = Date.parse('2026-09-30T07:42:00Z') / 1000;
const KEYS = ['3f0c9a52-8d4e-4b1a-9c7d-2e6f5a4b3c21', '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'];

function summaryOf(overrides: Partial<LoadedSummary> = {}, declaration = {}): LoadedSummary {
  return {
    declaration: sampleDeclaration({
      type: 'initial',
      statementDate: '2026-09-10',
      dueDate: '2026-10-10',
      commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
      sections: sections({
        bio: 'complete',
        household: 'complete',
        'statement:officer': 'complete',
        other: 'complete',
      }),
      ...declaration,
    }),
    document: { schemaVersion: 'declaration.v1' },
    valid: true,
    blocking: [],
    canSubmit: true,
    cannotSubmitReason: null,
    late: false,
    attestationText: ATTESTATION,
    ...overrides,
  };
}

/** Past its due date: submitting files late. */
const OVERDUE = summaryOf({ late: true }, { dueDate: '2026-09-20' });

function renderSummary({
  summary = summaryOf(),
  marker = null,
}: {
  summary?: LoadedSummary;
  marker?: 'done' | 'failed' | null;
} = {}) {
  return renderWorkspace(<SummaryView summary={summary} stepUpMarker={marker} />, {
    step: 'summary',
    declaration: summary.declaration,
  });
}

/** Opens the summary on the way back from a step-up that went through. */
async function returnFromStepUp(options: { summary?: LoadedSummary } = {}) {
  stepUpStatusMock.mockResolvedValue({
    status: 'ok',
    acr: 'step-up',
    authTime: AUTH_TIME,
    fresh: true,
  });
  await act(async () => {
    renderSummary({ ...options, marker: 'done' });
    await Promise.resolve();
  });
  return screen.getByRole('dialog', { name: 'Submit your declaration' });
}

function submitButton(scope: HTMLElement = document.body) {
  return within(scope).getByRole<HTMLButtonElement>('button', { name: 'Submit declaration' });
}

function affirm(dialog: HTMLElement) {
  fireEvent.click(
    within(dialog).getByRole('checkbox', {
      name: 'I affirm that this declaration is true and complete to the best of my knowledge',
    }),
  );
}

async function submitWith(dialog: HTMLElement, outcome: SubmitOutcome) {
  submitMock.mockResolvedValueOnce(outcome);
  await act(async () => {
    fireEvent.click(submitButton(dialog));
    await Promise.resolve();
  });
}

function keysSent() {
  return submitMock.mock.calls.map(([input]) => input.data.idempotencyKey);
}

const submitted = {
  status: 'submitted',
  result: {} as SubmissionResult,
} satisfies SubmitOutcome;

beforeEach(() => {
  let next = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(
    () => KEYS[next++ % KEYS.length] as `${string}-${string}-${string}-${string}-${string}`,
  );
  submitMock.mockReset();
  stepUpStatusMock.mockReset();
  stepUpMock.mockReset();
  vi.mocked(signInAgain).mockReset();
  navigate.mockReset();
  invalidate.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ready: Submit enabled when canSubmit', () => {
  it('says a one-time code comes first and goes to the step-up', () => {
    renderSummary();

    const button = submitButton();
    expect(button.disabled).toBe(false);
    const note = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe(
      'You will confirm your identity with a one-time code before submitting.',
    );
    fireEvent.click(button);
    expect(stepUpMock).toHaveBeenCalledWith(SUMMARY_PATH);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays disabled while something blocks', () => {
    renderSummary({
      summary: summaryOf({
        canSubmit: false,
        cannotSubmitReason: 'incomplete',
        valid: false,
        blocking: [
          { sectionKey: 'bio', path: '/officer/birth', code: 'required', message: 'Birth date.' },
        ],
      }),
    });

    expect(submitButton().disabled).toBe(true);
    expect(screen.getByText('Complete the 1 item listed above to submit.')).toBeTruthy();
  });

  it('says you affirm the solemn declaration when you submit', () => {
    renderSummary();

    expect(
      screen.getByText('You affirm this when you submit. No signature or witness needed.'),
    ).toBeTruthy();
  });
});

describe('step-up returned', () => {
  it('opens the affirmation dialog by itself and drops the marker from the URL', async () => {
    const dialog = await returnFromStepUp();

    expect(within(dialog).getByText('Identity confirmed at 10:42')).toBeTruthy();
    expect(within(dialog).getByText(`"${ATTESTATION}"`)).toBeTruthy();
    expect(within(dialog).getByText('Giving false information is an offence.')).toBeTruthy();
    expect(navigate).toHaveBeenCalledWith({ to: '.', search: {}, replace: true });
    expect(stepUpStatusMock).toHaveBeenCalledTimes(1);
  });

  it('reads a marker without a fresh step-up on the session as failed', async () => {
    stepUpStatusMock.mockResolvedValue({ status: 'ok', acr: null, authTime: null, fresh: false });
    await act(async () => {
      renderSummary({ marker: 'done' });
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('We could not confirm your identity. Try again.')).toBeTruthy();
  });

  it('drops the marker without opening anything when the summary cannot be submitted', async () => {
    await act(async () => {
      renderSummary({
        summary: summaryOf({ canSubmit: false, cannotSubmitReason: 'not-a-draft' }),
        marker: 'done',
      });
      await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stepUpStatusMock).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: '.', search: {}, replace: true });
  });
});

describe('step-up failed', () => {
  it('says so, focuses the alert and restarts the step-up from "Confirm identity"', async () => {
    await act(async () => {
      renderSummary({ marker: 'failed' });
      await Promise.resolve();
    });

    const alert = screen
      .getAllByRole('alert')
      .find((element) => element.textContent.includes('We could not confirm your identity.'));
    if (!alert) throw new Error('No step-up alert');
    expect(document.activeElement).toBe(alert);
    expect(stepUpStatusMock).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole('button', { name: 'Confirm identity' }));
    expect(stepUpMock).toHaveBeenCalledWith(SUMMARY_PATH);
  });

  it('comes back when submit answers 403 step-up-required', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, { status: 'step-up-required' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('We could not confirm your identity. Try again.')).toBeTruthy();
  });
});

describe('affirm', () => {
  it('keeps "Submit declaration" disabled until "I affirm" is ticked', async () => {
    const dialog = await returnFromStepUp();

    expect(submitButton(dialog).disabled).toBe(true);
    affirm(dialog);
    expect(submitButton(dialog).disabled).toBe(false);
  });

  it('warns that an overdue declaration is filed late', async () => {
    const dialog = await returnFromStepUp({ summary: OVERDUE });

    expect(
      within(dialog).getByText(
        'This declaration is being submitted after its due date (20 Sep 2026). It will be recorded as filed late.',
      ),
    ).toBeTruthy();
  });

  it('has no late warning before the due date', async () => {
    const dialog = await returnFromStepUp();

    expect(within(dialog).queryByText(/filed late/)).toBeNull();
  });

  it('closes on Cancel; Submit then starts over with the step-up', async () => {
    const dialog = await returnFromStepUp();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(submitButton());
    expect(stepUpMock).toHaveBeenCalledWith(SUMMARY_PATH);
  });
});

describe('submitting', () => {
  it('shows "Submitting…" and cannot be closed', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    submitMock.mockReturnValueOnce(new Promise(() => undefined));
    await act(async () => {
      fireEvent.click(submitButton(dialog));
      await Promise.resolve();
    });

    const busy = within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Submitting…' });
    expect(busy.disabled).toBe(true);
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Cancel' }).disabled).toBe(
      true,
    );
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Close' }).disabled).toBe(
      true,
    );
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Submit your declaration' })).toBeTruthy();
    expect(submitMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, idempotencyKey: KEYS[0] },
    });
  });
});

describe('conflict (409)', () => {
  it.each([
    ['before-statement-date', 'You can submit from 10 Sep 2026.'],
    ['amendment-window-closed', 'Amendments closed on 10 Oct 2026. Contact your Commission.'],
    [
      'obligation-cancelled',
      'This declaration is no longer required, so it cannot be submitted. Contact your Commission if you think this is wrong.',
    ],
  ] as const)('%s keeps the dialog open with the reason', async (code, message) => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, { status: 'conflict', code });

    expect(within(dialog).getByText(message)).toBeTruthy();
    expect(submitButton(dialog).disabled).toBe(true);
  });

  it('not-a-draft offers a reload, which closes the dialog and reloads the summary', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, { status: 'conflict', code: 'not-a-draft' });

    expect(
      within(dialog).getByText(
        'This declaration changed in another window. Reload to see its current state.',
      ),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reload' }));
    expect(invalidate).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('incomplete (400)', () => {
  it('closes the dialog, shows what blocks and reads the summary and section nav again', async () => {
    const blocking: CompletenessIssue[] = [
      {
        sectionKey: 'bio',
        path: '/officer/birth/date',
        code: 'required',
        message: 'Enter your date of birth.',
      },
    ];
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, { status: 'incomplete', blocking });

    expect(screen.queryByRole('dialog')).toBeNull();
    const panel = screen.getByRole('region', {
      name: '1 thing to complete before you can submit',
    });
    expect(within(panel).getByRole('link', { name: 'Enter your date of birth.' })).toBeTruthy();
    expect(screen.queryByText('Everything is complete.')).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(invalidate).toHaveBeenCalled();
  });

  it('gives way to a summary read after it, which says what blocks now', async () => {
    const blocking: CompletenessIssue[] = [
      {
        sectionKey: 'bio',
        path: '/officer/birth/date',
        code: 'required',
        message: 'Enter your date of birth.',
      },
    ];
    stepUpStatusMock.mockResolvedValue({
      status: 'ok',
      acr: 'step-up',
      authTime: AUTH_TIME,
      fresh: true,
    });
    const summary = summaryOf();
    const view = (loaded: LoadedSummary) =>
      workspaceTree(<SummaryView summary={loaded} stepUpMarker="done" />, {
        step: 'summary',
        declaration: loaded.declaration,
      });
    let rerender: (ui: ReactNode) => void = () => undefined;
    await act(async () => {
      rerender = render(view(summary)).rerender;
      await Promise.resolve();
    });
    const dialog = screen.getByRole('dialog', { name: 'Submit your declaration' });
    affirm(dialog);
    await submitWith(dialog, { status: 'incomplete', blocking });
    expect(submitButton().disabled).toBe(true);

    // Completed elsewhere meanwhile: the summary read again can be submitted.
    act(() => {
      rerender(view(summaryOf()));
    });

    expect(screen.getByText('Everything is complete.')).toBeTruthy();
    expect(submitButton().disabled).toBe(false);
  });
});

describe('error (5xx)', () => {
  it('says it was not submitted and retries with the same Idempotency-Key', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, { status: 'unavailable' });

    expect(within(dialog).getByText('Your declaration was not submitted. Try again.')).toBeTruthy();
    expect(submitButton(dialog).disabled).toBe(false);
    await submitWith(dialog, submitted);

    expect(keysSent()).toEqual([KEYS[0], KEYS[0]]);
  });

  it('reads a failed server call as not submitted', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    submitMock.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      fireEvent.click(submitButton(dialog));
      await Promise.resolve();
    });

    expect(within(dialog).getByText('Your declaration was not submitted. Try again.')).toBeTruthy();
  });
});

describe('submitted (201)', () => {
  it('goes to the success page', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    await submitWith(dialog, submitted);

    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id/submitted',
      params: { id: DECLARATION_ID },
    });
  });
});

describe('signed out', () => {
  it('signs in again and comes back to the summary', async () => {
    const dialog = await returnFromStepUp();
    affirm(dialog);
    submitMock.mockResolvedValueOnce({ status: 'unauthenticated' });
    await act(async () => {
      fireEvent.click(submitButton(dialog));
      await Promise.resolve();
    });

    expect(signInAgain).toHaveBeenCalledWith(SUMMARY_PATH);
  });
});

describe('amending (spec 06 FE-4)', () => {
  const amending = summaryOf(
    {},
    {
      status: 'amending',
      reference: 'DCI-PSC-2026-0000001-7',
      currentVersion: 1,
      amendingFromVersion: 1,
    },
  );

  it('says the amendment files version 2, with the banner and Discard amendment', () => {
    renderSummary({ summary: amending });

    expect(screen.getByText('Submit version 2')).toBeTruthy();
    expect(
      screen.getByText(
        'You are amending version 1. Submit again to file version 2, or discard the amendment to keep version 1.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Amending version 1')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Discard amendment' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Discard draft' })).toBeNull();
  });

  it('titles the affirmation "Submit version 2"', async () => {
    stepUpStatusMock.mockResolvedValue({
      status: 'ok',
      acr: 'step-up',
      authTime: AUTH_TIME,
      fresh: true,
    });
    await act(async () => {
      renderSummary({ summary: amending, marker: 'done' });
      await Promise.resolve();
    });

    expect(screen.getByRole('dialog', { name: 'Submit version 2' })).toBeTruthy();
  });

  it('goes back to My declarations once the amendment is discarded', async () => {
    vi.mocked(discardMyAmendment).mockResolvedValue({
      status: 'discarded',
      declaration: amending.declaration,
    });
    renderSummary({ summary: amending });
    const [inBanner] = screen.getAllByRole('button', { name: 'Discard amendment' });
    if (!inBanner) throw new Error('no Discard amendment');
    fireEvent.click(inBanner);
    const dialog = screen.getByRole('dialog', { name: 'Discard this amendment?' });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Discard amendment' }));
      await Promise.resolve();
    });

    expect(discardMyAmendment).toHaveBeenCalledWith({ data: { declarationId: DECLARATION_ID } });
    expect(navigate).toHaveBeenCalledWith({ to: '/declarations', search: { discarded: 1 } });
  });
});
