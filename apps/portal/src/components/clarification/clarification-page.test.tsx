// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { respondToMyClarification } from '../../server/clarifications';
import { completeAttachmentUpload, createAttachmentUpload } from '../../server/documents/uploads';
import type { ClarificationLink } from '../../server/clarifications.server';
import {
  MOCK_CLARIFICATION_IDS as IDS,
  mockClarification,
  resetReviewMock,
} from '../../server/review/mock.server';
import type { DeclarantClarification } from '../../server/review/types';
import { invalidate } from '../declaration/testing-mocks';
import { ClarificationPage } from './clarification-page';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/clarifications', () => ({
  respondToMyClarification: vi.fn(),
  getMyClarification: vi.fn(),
}));
vi.mock('../../server/documents/uploads', () => ({
  createAttachmentUpload: vi.fn(),
  completeAttachmentUpload: vi.fn(),
  getAttachmentUpload: vi.fn(),
}));
// The PUT to storage is XHR; everything else in the upload flow runs for real.
vi.mock(import('../declaration/attachment-upload'), async (importOriginal) => ({
  ...(await importOriginal()),
  putToPresignedUrl: vi.fn(() => Promise.resolve()),
}));

const respondMock = vi.mocked(respondToMyClarification);
const reserveMock = vi.mocked(createAttachmentUpload);
const completeMock = vi.mocked(completeAttachmentUpload);

const NOW_MS = Date.parse('2026-09-28T09:00:00Z');
const NOW = new Date(NOW_MS).toISOString();

function fixture(id: string): DeclarantClarification {
  const found = mockClarification(id);
  if (!found) throw new Error(id);
  return found;
}

function renderPage(
  clarification: DeclarantClarification,
  links: { followUps?: ClarificationLink[]; original?: ClarificationLink | null } = {},
) {
  render(
    <ToastProvider>
      <ClarificationPage
        clarification={clarification}
        followUps={links.followUps ?? []}
        original={links.original ?? null}
        now={NOW}
      />
    </ToastProvider>,
  );
}

function answer(point: number, text: string) {
  fireEvent.change(screen.getByLabelText(`Your response to point ${String(point)}`), {
    target: { value: text },
  });
}

beforeEach(() => {
  // Only Date: the confirm dialog reads the clock; promises and timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
  resetReviewMock(NOW_MS);
  respondMock.mockReset();
  invalidate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ClarificationPage: open', () => {
  it('shows each point with what the Commission asks, the deadline and the letter (S20)', () => {
    renderPage(fixture(IDS.open));

    expect(screen.getByRole('heading', { level: 1, name: 'Clarification' })).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Answer every point. You can respond once.')).toBeTruthy();
    expect(screen.getByText('Point 1 of 2')).toBeTruthy();
    expect(
      screen.getByText('Your Commission asks you to explain the discrepancy in:'),
    ).toBeTruthy();
    expect(
      screen.getByText('Your Commission asks you to provide the omitted information for:'),
    ).toBeTruthy();
    expect(screen.getByText('Respond within 22 days')).toBeTruthy();
    expect(screen.getByText('Digitally signed')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('href')).toBe(
      `/api/mock-letters/${IDS.open}`,
    );
    expect(screen.getByText('0 of 2 points answered')).toBeTruthy();
  });

  it('says when parts were drafted with AI and approved at the Commission (ADR-007)', () => {
    const note = /drafted with AI assistance, then checked and approved/;
    renderPage(fixture(IDS.open));
    expect(screen.queryByText(note)).toBeNull();
    cleanup();
    renderPage({ ...fixture(IDS.open), openingAiJobId: '0199a000-0000-7000-8000-00000000d0b1' });
    expect(screen.getByText(note)).toBeTruthy();
  });

  it('shows what a Swahili letter asks in Swahili, and the page around it as before (S7)', () => {
    renderPage({ ...fixture(IDS.open), language: 'sw' });
    const ask = screen.getByText('Tume yako inakuomba ueleze tofauti iliyopo katika:');
    expect(ask.closest('[lang]')?.getAttribute('lang')).toBe('sw');
    expect(screen.getByText('Tume yako inakuomba utoe taarifa zilizoachwa kuhusu:')).toBeTruthy();
    expect(
      screen.queryByText('Your Commission asks you to explain the discrepancy in:'),
    ).toBeNull();
    expect(screen.getByText('Answer every point. You can respond once.')).toBeTruthy();
  });

  it('will not submit until every point is answered, and says which one (S20)', () => {
    renderPage(fixture(IDS.open));
    answer(1, 'I built a house on the plot.');
    expect(screen.getByText('1 of 2 points answered')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));

    expect(screen.getByText('Write your response to this point.')).toBeTruthy();
    expect(
      screen.getByText('Answer every point before you submit. Point 2 needs an answer.'),
    ).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Your response to point 2'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('flags an answer over 2,000 characters', () => {
    renderPage(fixture(IDS.open));
    answer(1, 'x'.repeat(2001));
    expect(screen.getByText('2,001 / 2,000')).toBeTruthy();
    expect(screen.getByText('Keep your response to 2,000 characters or fewer.')).toBeTruthy();
  });

  it('confirms once, sends the answers and then shows them read-only (S14)', async () => {
    const open = fixture(IDS.open);
    renderPage(open);
    answer(1, '  I built a house on the plot.  ');
    answer(2, 'Mwalimu SACCO loan, March 2025.');
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));

    const dialog = screen.getByRole('dialog', { name: 'Submit your response?' });
    expect(
      within(dialog).getByText('You can respond once. Make sure every point is answered.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('2 of 2')).toBeTruthy();
    expect(within(dialog).queryByText(/recorded as/)).toBeNull();

    const submittedAt = '2026-09-28T09:05:00.000Z';
    respondMock.mockResolvedValue({
      status: 'responded',
      clarification: {
        ...open,
        status: 'responded',
        respondedAt: submittedAt,
        response: {
          submittedAt,
          items: [
            { index: 0, text: 'I built a house on the plot.', attachments: [] },
            { index: 1, text: 'Mwalimu SACCO loan, March 2025.', attachments: [] },
          ],
        },
      },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Submit response' }));
      await Promise.resolve();
    });

    const sent = respondMock.mock.calls[0]?.[0].data;
    expect(sent?.clarificationId).toBe(IDS.open);
    expect(sent?.items).toEqual([
      { index: 0, text: 'I built a house on the plot.', attachments: [] },
      { index: 1, text: 'Mwalimu SACCO loan, March 2025.', attachments: [] },
    ]);
    expect(screen.getByText('Response submitted 28 Sep 2026, 12:05.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What was asked and your response' })).toBeTruthy();
    expect(screen.getByText('I built a house on the plot.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit response' })).toBeNull();
    expect(screen.getByText('Responded on time')).toBeTruthy();
    expect(screen.getByText('Response sent to your Commission.')).toBeTruthy();
  });

  it('uploads a document for a point as a clarification attachment and sends it (S14)', async () => {
    const uploadId = '5a0e2f7c-1b9d-4c3e-8f6a-000000000001';
    reserveMock.mockResolvedValue({
      status: 'reserved',
      reservation: {
        id: uploadId,
        uploadUrl: '/upload',
        expiresAt: '2026-09-28T10:00:00Z',
        maxSize: 20 * 1024 * 1024,
      },
    });
    completeMock.mockResolvedValue({ status: 'clean', sha256: 'abc', size: 1200 });
    respondMock.mockResolvedValue({ status: 'unavailable' });
    renderPage(fixture(IDS.open));
    answer(1, 'One');
    answer(2, 'Two');

    const input = screen
      .getByLabelText('Your response to point 1')
      .closest('li')
      ?.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(['x'.repeat(1200)], 'boq.pdf', { type: 'application/pdf' })] },
      });
      await Promise.resolve();
    });

    expect(reserveMock.mock.calls[0]?.[0].data.purpose).toBe('clarification-attachment');
    expect(screen.getByText('boq.pdf')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(within(screen.getByRole('dialog')).getByText('1', { selector: 'dd' })).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit response' }),
      );
      await Promise.resolve();
    });
    expect(respondMock.mock.calls[0]?.[0].data.items[0]?.attachments).toEqual([uploadId]);
  });

  it('keeps the answers and says so when sending fails, then retries with the same key', async () => {
    renderPage(fixture(IDS.open));
    answer(1, 'One');
    answer(2, 'Two');
    respondMock.mockResolvedValueOnce({ status: 'unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit response' }),
      );
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        'We could not send your response. Check your connection and try again. Your answers are still here.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Your response to point 1')).toHaveProperty('value', 'One');

    respondMock.mockResolvedValueOnce({ status: 'unavailable' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit response' }),
      );
      await Promise.resolve();
    });
    const keys = respondMock.mock.calls.map((call) => call[0].data.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('says a response was already sent when the service answers 409', async () => {
    renderPage(fixture(IDS.open));
    answer(1, 'One');
    answer(2, 'Two');
    respondMock.mockResolvedValue({ status: 'conflict', reason: 'already-responded' });
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Submit response' }),
      );
      await Promise.resolve();
    });

    expect(screen.getByText('A response was already submitted,')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Submit response' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(invalidate).toHaveBeenCalled();
  });
});

describe('ClarificationPage: deadline states', () => {
  it('reminds the declarant after day 20', () => {
    renderPage(fixture(IDS.reminder));
    expect(screen.getByText('Reminder: respond within 8 days. Due 6 Oct 2026.')).toBeTruthy();
    expect(screen.getByText('Reminder sent')).toBeTruthy();
  });

  it('keeps an overdue clarification open and warns the response will be late', () => {
    renderPage(fixture(IDS.overdue));
    expect(screen.getByText('The deadline has passed.')).toBeTruthy();
    expect(
      screen.getByText('You can still respond; your response will be recorded as late.'),
    ).toBeTruthy();
    expect(screen.getByText('Overdue by 3 days')).toBeTruthy();

    answer(1, 'Loan details');
    fireEvent.click(screen.getByRole('button', { name: 'Submit response' }));
    expect(
      within(screen.getByRole('dialog')).getByText(
        'The due date was 25 Sep 2026. Your response will be recorded as 3 days late.',
      ),
    ).toBeTruthy();
  });
});

describe('ClarificationPage: after the response', () => {
  it('shows a late response read-only with its documents (S20)', () => {
    renderPage(fixture(IDS.late));
    expect(screen.getByText('Responded 3 days late.', { exact: false })).toBeTruthy();
    expect(screen.getByText('Responded 3 days late')).toBeTruthy();
    expect(screen.getByText('bill-of-quantities.pdf')).toBeTruthy();
    expect(screen.getByText(/Teachers Service Commission will review it\./)).toBeTruthy();
    expect(screen.getByText('You responded (3 days late)')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('points to a further clarification, and back from it', () => {
    const further: ClarificationLink = {
      id: IDS.further,
      reference: fixture(IDS.further).reference,
    };
    renderPage(fixture(IDS.answered), { followUps: [further] });
    expect(
      screen.getByText('Teachers Service Commission sent a further clarification.'),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: `Open ${String(further.reference)}` }).getAttribute('href'),
    ).toBe(`/clarifications/${IDS.further}`);
  });

  it('opens a follow-up with a link to what was said before', () => {
    const original = { id: IDS.answered, reference: fixture(IDS.answered).reference };
    renderPage(fixture(IDS.further), { original });
    expect(screen.getByRole('heading', { level: 1, name: 'Further clarification' })).toBeTruthy();
    expect(
      screen.getByText(`Follows up on your response to ${String(original.reference)}.`),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what you said before' })).toBeTruthy();
  });

  it('shows a resolved clarification', () => {
    renderPage(fixture(IDS.resolved));
    expect(screen.getByText('Resolved on 15 Aug 2026.')).toBeTruthy();
    expect(screen.getByText('Teachers Service Commission accepted your response.')).toBeTruthy();
  });

  it('shows a withdrawn clarification with its letter revoked and nothing to answer', () => {
    renderPage(fixture(IDS.withdrawn));
    expect(screen.getByText('Withdrawn: issued in error.')).toBeTruthy();
    expect(screen.getByText('You do not need to respond.')).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.getByText('No response needed')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'What was asked' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
