// @vitest-environment jsdom
import { ToastProvider, TooltipProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CertifiedCopy } from '../../server/access/types';
import {
  getMyCertifiedCopy,
  getMyCertifiedCopyDownload,
  requestMyCertifiedCopy,
} from '../../server/certified-copies';
import type { DeclarationVersion } from '../../server/declarations/types';
import type { SubmittedVersion } from '../../server/my-declarations.server';
import { downloadFrom } from '../download';
import { CopiesView } from './copies-view';
import { COPY_POLL_MS } from './use-certified-copies';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/certified-copies', () => ({
  getMyCertifiedCopy: vi.fn(),
  getMyCertifiedCopyDownload: vi.fn(),
  requestMyCertifiedCopy: vi.fn(),
}));
vi.mock('../download', () => ({ downloadFrom: vi.fn() }));

/** Clicks, and lets the server functions it calls settle. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

const DECLARATION = 'd0c20000-0000-4000-8000-000000000001';
const TSC = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };

function version(number: number, supersededAt: string | null): SubmittedVersion {
  return {
    declarationId: DECLARATION,
    commission: TSC,
    type: 'initial',
    statementDate: '2026-04-01',
    version: {
      version: number,
      reference: 'DCI-TSC-2026-0003418-U',
      submittedAt: `2026-0${String(4 + number)}-12T09:00:00Z`,
      late: false,
      canonicalSha256: '0'.repeat(64),
      supersededAt,
      acknowledgement: {
        status: 'issued',
        documentId: null,
        verificationId: null,
        verifyUrl: null,
        verifiedCount: 0,
      },
    } as DeclarationVersion,
  };
}

const VERSIONS = [version(2, null), version(1, '2026-06-12T09:00:00Z')];

function copy(fields: Partial<CertifiedCopy>): CertifiedCopy {
  return {
    id: 'c0c20000-0000-4000-8000-000000000001',
    commission: { slug: 'tsc', name: 'Teachers Service Commission' },
    declarationId: DECLARATION,
    version: 2,
    reference: null,
    status: 'pending',
    documentId: null,
    verificationId: null,
    requestedAt: '2026-10-02T07:00:00Z',
    issuedAt: null,
    ...fields,
  };
}

const ISSUED = copy({
  status: 'issued',
  reference: 'DCI-TSC-2026-0003418-U',
  documentId: 'd0c30000-0000-4000-8000-000000000001',
  issuedAt: '2026-10-02T07:00:03Z',
});

function renderView(copies: CertifiedCopy[] = [], versions = VERSIONS) {
  const onPage = vi.fn();
  render(
    <ToastProvider>
      <TooltipProvider>
        <CopiesView versions={versions} copies={copies} page={1} onPage={onPage} />
      </TooltipProvider>
    </ToastProvider>,
  );
  return { onPage };
}

function rowOf(version: number): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => item.textContent.includes(`version ${String(version)}`));
  if (!row) throw new Error(`No row for version ${String(version)}`);
  return row;
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('Certified copies (S13)', () => {
  it('lists every submitted version, superseded ones marked, each with Request', () => {
    renderView();
    const current = rowOf(2);
    expect(current.textContent).toContain('Initial declaration');
    expect(current.textContent).toContain('DCI-TSC-2026-0003418-U');
    expect(current.textContent).not.toContain('Superseded');
    expect(rowOf(1).textContent).toContain('Superseded');
    expect(
      within(current).getByRole('button', {
        name: 'Request certified copy of Initial declaration, version 2',
      }),
    ).toBeDefined();
  });

  it('asks for a copy, shows Preparing while it is issued, then Download', async () => {
    vi.useFakeTimers();
    vi.mocked(requestMyCertifiedCopy).mockResolvedValue({ status: 'ok', copy: copy({}) });
    vi.mocked(getMyCertifiedCopy).mockResolvedValue({ status: 'ok', copy: ISSUED });
    vi.mocked(getMyCertifiedCopyDownload).mockResolvedValue({
      status: 'ok',
      downloadUrl: '/copy.pdf',
    });
    renderView();

    await click(within(rowOf(2)).getByRole('button', { name: /Request certified copy/ }));
    expect(vi.mocked(requestMyCertifiedCopy).mock.calls[0]?.[0].data).toMatchObject({
      commission: 'tsc',
      declarationId: DECLARATION,
      version: 2,
    });
    expect(within(rowOf(2)).getByRole('button', { name: /Preparing/ })).toHaveProperty(
      'disabled',
      true,
    );
    const status = within(rowOf(2)).getByRole('status');
    expect(status.textContent).toBe(
      'Preparing the certified copy of Initial declaration, version 2.',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COPY_POLL_MS);
    });
    expect(getMyCertifiedCopy).toHaveBeenCalledWith({ data: { copyId: ISSUED.id } });
    expect(rowOf(2).textContent).toContain('Certified 2 Oct 2026');
    expect(screen.getByText('Certified copy ready')).toBeDefined();
    // The same region, still there, says it is ready.
    expect(within(rowOf(2)).getByRole('status')).toBe(status);
    expect(status.textContent).toBe(
      'The certified copy of Initial declaration, version 2 is ready to download.',
    );

    await click(
      within(rowOf(2)).getByRole('button', {
        name: 'Download certified copy of Initial declaration, version 2',
      }),
    );
    expect(getMyCertifiedCopyDownload).toHaveBeenCalledWith({
      data: { documentId: ISSUED.documentId },
    });
    expect(downloadFrom).toHaveBeenCalledWith('/copy.pdf');
  });

  it('starts from copies already asked for', () => {
    renderView([
      ISSUED,
      copy({ id: 'c0c20000-0000-4000-8000-000000000002', version: 1, status: 'failed' }),
    ]);
    // Nothing is announced for the state the page loads in.
    expect(within(rowOf(2)).getByRole('status').textContent).toBe('');
    expect(within(rowOf(2)).getByRole('button', { name: /Download/ })).toBeDefined();
    expect(rowOf(1).textContent).toContain('We could not prepare the copy. Try again.');
    expect(within(rowOf(1)).getByRole('button', { name: /Try again/ })).toBeDefined();
  });

  it('asks again when a copy could not be prepared', async () => {
    vi.mocked(requestMyCertifiedCopy).mockResolvedValue({ status: 'ok', copy: ISSUED });
    renderView([copy({ status: 'failed' })]);
    await click(within(rowOf(2)).getByRole('button', { name: /Try again/ }));
    expect(requestMyCertifiedCopy).toHaveBeenCalledTimes(1);
    expect(within(rowOf(2)).getByRole('button', { name: /Download/ })).toBeDefined();
  });

  it('says so when the copy could not be asked for, and offers Request again', async () => {
    vi.mocked(requestMyCertifiedCopy).mockResolvedValue({ status: 'unavailable' });
    renderView();
    await click(within(rowOf(2)).getByRole('button', { name: /Request certified copy/ }));
    expect(
      screen.getByText('We could not ask for the copy. Try again in a few minutes.'),
    ).toBeDefined();
    expect(within(rowOf(2)).getByRole('button', { name: /Request certified copy/ })).toBeDefined();
  });

  it('says so when the download link could not be had', async () => {
    vi.mocked(getMyCertifiedCopyDownload).mockResolvedValue({ status: 'unavailable' });
    renderView([ISSUED]);
    await click(within(rowOf(2)).getByRole('button', { name: /Download/ }));
    expect(screen.getByText('We could not download the copy. Try again.')).toBeDefined();
    expect(downloadFrom).not.toHaveBeenCalled();
  });

  it('has an empty state before anything is submitted', () => {
    renderView([], []);
    expect(screen.getByText('No submitted declarations')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/');
  });
});
