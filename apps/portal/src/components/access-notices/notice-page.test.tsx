// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { submitMyRepresentations } from '../../server/access-notices';
import type { SaveResult } from '../../server/access-notices.server';
import type { DeclarantNotice } from '../../server/access/types';
import { completeAttachmentUpload, createAttachmentUpload } from '../../server/documents/uploads';
import { NoticePage } from './notice-page';
import { IDS, NOW, seededNotice } from './testing';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/access-notices', () => ({
  submitMyRepresentations: vi.fn(),
  getMyAccessNotices: vi.fn(),
  getMyAccessNotice: vi.fn(),
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

const submitMock = vi.mocked(submitMyRepresentations);
const reserveMock = vi.mocked(createAttachmentUpload);
const completeMock = vi.mocked(completeAttachmentUpload);

afterEach(() => {
  vi.clearAllMocks();
});

function renderPage(notice: DeclarantNotice) {
  render(
    <ToastProvider>
      <TooltipProvider>
        <NoticePage notice={notice} now={NOW} />
      </TooltipProvider>
    </ToastProvider>,
  );
}

const banner = () => screen.getAllByRole('status')[0]?.textContent ?? '';

async function press(name: string, scope: HTMLElement = document.body) {
  await act(async () => {
    fireEvent.click(within(scope).getByRole('button', { name }));
    await Promise.resolve();
  });
}

/** What the service answers to a save: the notice with the body applied. */
function saved(notice: DeclarantNotice, change: Partial<DeclarantNotice>): SaveResult {
  return { status: 'saved', notice: { ...notice, ...change } };
}

describe('a request waiting for the declarant (S4)', () => {
  it('says someone has requested access, by whom, why, what and by when', async () => {
    renderPage(await seededNotice(IDS.awaiting));
    expect(screen.getByRole('heading', { level: 1, name: 'Access request' })).toBeTruthy();
    expect(banner()).toBe(
      'Someone has requested access to your declaration. Respond by 7 Oct 2026, 07:00. Teachers Service Commission decides after that.',
    );
    expect(screen.getByText('Wanjiru Kamau')).toBeTruthy();
    expect(
      screen.getByText('Journalistic research on school procurement in Nakuru County'),
    ).toBeTruthy();
    expect(screen.getByText('Waiting for your response')).toBeTruthy();
    expect(screen.getByText('Children').closest('li')?.textContent).toContain('(not asked)');
    // Twice: before the request on a phone, beside it from lg (CSS picks one).
    const [window] = screen.getAllByRole('group', { name: 'Window for your response' });
    if (!window) throw new Error('no window card');
    expect(window.textContent).toContain('5 days left');
    expect(screen.getByRole('radiogroup', { name: 'Your position' })).toBeTruthy();
  });

  it('asks for a stance, then for reasons, before sending', async () => {
    renderPage(await seededNotice(IDS.awaiting));
    await press('Send response');
    expect(screen.getAllByText('Choose object, consent or add context.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Object' }));
    await press('Send response');
    expect(screen.getByText('Write your reasons.')).toBeTruthy();
    expect(submitMock).not.toHaveBeenCalled();
  });

  it('sends an objection, then shows it with Edit until the window closes', async () => {
    const notice = await seededNotice(IDS.awaiting);
    renderPage(notice);
    fireEvent.click(screen.getByRole('radio', { name: 'Object' }));
    fireEvent.change(screen.getByLabelText('Your reasons'), {
      target: { value: '  The plot is in court.  ' },
    });
    submitMock.mockResolvedValueOnce(
      saved(notice, {
        representations: {
          stance: 'object',
          text: 'The plot is in court.',
          attachments: [],
          submittedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    await press('Send response');

    expect(submitMock.mock.calls[0]?.[0].data).toMatchObject({
      requestId: IDS.awaiting,
      stance: 'object',
      text: 'The plot is in court.',
      attachments: [],
    });
    expect(banner()).toBe('Your response is saved. You can edit it until 7 Oct 2026, 07:00.');
    expect(
      screen.getByText(
        'Response sent to Teachers Service Commission. You can edit it until 7 Oct 2026.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('You objected')).toHaveLength(2);
    expect(screen.queryByRole('radiogroup')).toBeNull();

    await press('Edit');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Your reasons').value).toBe(
      'The plot is in court.',
    );
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    await press('Cancel');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('confirms a consent, which closes the window early', async () => {
    const notice = await seededNotice(IDS.awaiting);
    renderPage(notice);
    fireEvent.click(screen.getByRole('radio', { name: 'Consent' }));
    expect(screen.getByLabelText(/^Comments/)).toBeTruthy();
    await press('Send response');
    const dialog = screen.getByRole('dialog', { name: 'Consent to release?' });
    expect(dialog.textContent).toContain('2026 · You and spouse · Income, assets, liabilities');
    expect(submitMock).not.toHaveBeenCalled();

    submitMock.mockResolvedValueOnce(
      saved(notice, {
        status: 'under-decision',
        canRespond: false,
        representations: {
          stance: 'consent',
          text: '',
          attachments: [],
          submittedAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
    await press('Consent and send', dialog);
    expect(submitMock.mock.calls[0]?.[0].data).toMatchObject({ stance: 'consent', text: '' });
    expect(banner()).toBe(
      'You consented. Teachers Service Commission can now decide. We will SMS and email you the outcome.',
    );
    expect(screen.getAllByText('Closed early').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps the form but disables it when the window closed while writing (409)', async () => {
    renderPage(await seededNotice(IDS.closing));
    fireEvent.click(screen.getByRole('radio', { name: 'Add context' }));
    fireEvent.change(screen.getByLabelText('Context for Teachers Service Commission'), {
      target: { value: 'I moved schools in 2024.' },
    });
    submitMock.mockResolvedValueOnce({ status: 'closed' });
    await press('Send response');

    expect(banner()).toBe(
      'The window has closed. Your response was not saved. Teachers Service Commission is deciding.',
    );
    expect(screen.getByText('Under decision')).toBeTruthy();
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Context for Teachers Service Commission').value,
    ).toBe('I moved schools in 2024.');
    expect(screen.getByRole('radio', { name: 'Add context' }).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Send response' })).toBeNull();
  });

  it('says so when saving fails and retries with the same key', async () => {
    renderPage(await seededNotice(IDS.awaiting));
    fireEvent.click(screen.getByRole('radio', { name: 'Object' }));
    fireEvent.change(screen.getByLabelText('Your reasons'), { target: { value: 'In court.' } });
    submitMock.mockResolvedValue({ status: 'unavailable' });
    await press('Send response');
    expect(
      screen.getByText('We could not save your response. Check your connection and try again.'),
    ).toBeTruthy();
    await press('Send response');
    const [first, second] = submitMock.mock.calls.map((call) => call[0].data.idempotencyKey);
    expect(second).toBe(first);

    fireEvent.change(screen.getByLabelText('Your reasons'), { target: { value: 'Changed.' } });
    await press('Send response');
    expect(submitMock.mock.calls[2]?.[0].data.idempotencyKey).not.toBe(first);
  });

  it('offers sign in again when the session has ended', async () => {
    renderPage(await seededNotice(IDS.awaiting));
    fireEvent.click(screen.getByRole('radio', { name: 'Object' }));
    fireEvent.change(screen.getByLabelText('Your reasons'), { target: { value: 'In court.' } });
    submitMock.mockResolvedValueOnce({ status: 'unauthenticated' });
    await press('Send response');
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain(
      encodeURIComponent(`/access/notices/${IDS.awaiting}`),
    );
  });

  it('uploads a document as an access representation and sends it', async () => {
    const uploadId = '5a0e2f7c-1b9d-4c3e-8f6a-000000000001';
    reserveMock.mockResolvedValue({
      status: 'reserved',
      reservation: {
        id: uploadId,
        uploadUrl: '/upload',
        expiresAt: '2026-10-02T08:00:00Z',
        maxSize: 20 * 1024 * 1024,
      },
    });
    completeMock.mockResolvedValue({ status: 'clean', sha256: 'abc', size: 1200 });
    submitMock.mockResolvedValue({ status: 'unavailable' });
    renderPage(await seededNotice(IDS.awaiting));
    fireEvent.click(screen.getByRole('radio', { name: 'Object' }));
    fireEvent.change(screen.getByLabelText('Your reasons'), { target: { value: 'In court.' } });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('no file input');
    await act(async () => {
      fireEvent.change(input, {
        target: {
          files: [new File(['x'.repeat(1200)], 'notice.pdf', { type: 'application/pdf' })],
        },
      });
      await Promise.resolve();
    });

    expect(reserveMock.mock.calls[0]?.[0].data.purpose).toBe('access-representation');
    expect(screen.getByText('notice.pdf')).toBeTruthy();
    await press('Send response');
    expect(submitMock.mock.calls[0]?.[0].data.attachments).toEqual([uploadId]);
  });
});

describe('after the window and the decision', () => {
  it('says the window closed without a response, or with one, while deciding', async () => {
    renderPage(await seededNotice(IDS.closedNone));
    expect(banner()).toBe(
      'The window closed on 30 Sep 2026. You did not respond. Teachers Service Commission is deciding.',
    );
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows the response sent before the window closed, without Edit', async () => {
    renderPage(await seededNotice(IDS.closedObjected));
    expect(banner()).toMatch(/Teachers Service Commission has your response and is deciding\.$/);
    expect(screen.getByText('ELC case 118 of 2026 hearing notice.pdf')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows a partial grant with its grounds and reasons, and what was withheld', async () => {
    renderPage(await seededNotice(IDS.partial));
    expect(banner()).toBe(
      'Teachers Service Commission partially granted access on 2 Sep 2026. Only part of what was asked was released.',
    );
    expect(screen.getByText('Does not promote the objectives of the Act')).toBeTruthy();
    expect(screen.getByText('Scope asked and granted')).toBeTruthy();
    expect(screen.getByText('Liabilities').closest('li')?.textContent).toContain('(not released)');
    expect(screen.getByText('Income').closest('li')?.textContent).not.toContain('(');
    expect(screen.queryByRole('group', { name: 'Window for your response' })).toBeNull();
  });

  it('shows a denial and a grant', async () => {
    renderPage(await seededNotice(IDS.denied));
    expect(banner()).toBe(
      'Teachers Service Commission denied access on 30 Jul 2026. Nothing was released.',
    );
    expect(screen.getByText('Frivolous, vexatious or scandalous')).toBeTruthy();
  });

  it('says the applicant withdrew', async () => {
    renderPage(await seededNotice(IDS.withdrawn));
    expect(banner()).toBe('The applicant withdrew the request. Nothing was released.');
    // The response card and the history.
    expect(screen.getAllByText('You added context')).toHaveLength(2);
  });

  it('shows a law-enforcement grant without a form', async () => {
    renderPage(await seededNotice(IDS.lea));
    expect(screen.getByRole('heading', { level: 1, name: 'Law-enforcement access' })).toBeTruthy();
    expect(banner()).toMatch(
      /^A law-enforcement agency was granted access on 6 Sep 2026 \(Asset Recovery Agency, case ARA\/INV\/2026\/014\)\./,
    );
    expect(screen.getByText('Scope granted')).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByText('Your response')).toBeNull();
  });
});
