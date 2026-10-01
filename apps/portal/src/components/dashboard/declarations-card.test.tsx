// @vitest-environment jsdom
import { ToastProvider } from '@adili/ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { discardMyDeclaration } from '../../server/declarations';
import type { DeclarationListResult } from '../../server/declarations.server';
import type { DeclarationListItem } from '../../server/declarations/types';
import { DISCARD_TITLE } from '../declaration/discard-dialog';
import { invalidate } from '../declaration/testing-mocks';
import { orderDeclarations } from '../../declaration/my-declarations';
import { DeclarationsCard } from './declarations-card';

vi.mock('@tanstack/react-router', async () =>
  (await import('../declaration/testing-mocks')).routerMock(),
);
vi.mock('../../server/declarations', async () =>
  (await import('../declaration/testing-mocks')).serverMock(),
);

const discardMock = vi.mocked(discardMyDeclaration);

const TSC = { slug: 'tsc', issuerCode: 'TSC', name: 'Teachers Service Commission' };
const PSC = { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' };
const DRAFT = '9d3c2b1a-0f4e-4d5c-8b7a-6f5e4d3c2b1a';

function item(overrides: Partial<DeclarationListItem> = {}): DeclarationListItem {
  return {
    id: DRAFT,
    obligationId: '0b1e5a1d-5c0a-4d3e-9f10-000000000001',
    commission: TSC,
    type: 'biennial',
    statementDate: '2027-11-01',
    status: 'draft',
    completenessPercent: 40,
    dueDate: '2027-12-31',
    reference: null,
    currentVersion: null,
    amendingFromVersion: null,
    submittedAt: null,
    late: null,
    amendable: false,
    acknowledgement: null,
    updatedAt: '2026-09-27T08:15:00Z',
    ...overrides,
  };
}

function renderCard(declarations: DeclarationListResult) {
  return render(
    <ToastProvider>
      <DeclarationsCard declarations={declarations} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  discardMock.mockReset();
  invalidate.mockClear();
});

describe('DeclarationsCard', () => {
  it('lists a draft with its completeness, Continue and Discard', () => {
    renderCard({ status: 'ok', declarations: [item()] });

    expect(screen.getByRole('heading', { name: 'Your declarations' })).toBeTruthy();
    const row = screen.getByRole('listitem');
    expect(
      within(row).getByRole('heading', {
        name: 'Biennial declaration · Teachers Service Commission',
      }),
    ).toBeTruthy();
    expect(
      within(row).getByText('Statement date 1 Nov 2027 · Saved 27 Sep 2026, 11:15'),
    ).toBeTruthy();
    expect(within(row).getByText('40% complete')).toBeTruthy();
    expect(within(row).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    expect(within(row).getByText('Draft')).toBeTruthy();
    expect(
      within(row).getByRole('link', { name: 'Continue Biennial declaration' }).getAttribute('href'),
    ).toBe(`/declarations/${DRAFT}`);
    expect(within(row).getByRole('button', { name: 'Discard Biennial declaration' })).toBeTruthy();
  });

  it('lists drafts first, then by statement date, and submitted ones read-only', () => {
    const submitted = item({
      id: 'b',
      status: 'submitted',
      commission: PSC,
      type: 'initial',
      statementDate: '2028-01-01',
    });
    const older = item({ id: 'c', statementDate: '2025-11-01' });
    expect(orderDeclarations([submitted, older, item()]).map((entry) => entry.id)).toEqual([
      DRAFT,
      'c',
      'b',
    ]);

    renderCard({ status: 'ok', declarations: [submitted] });
    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Submitted')).toBeTruthy();
    expect(within(row).queryByRole('link')).toBeNull();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('says when a submitted declaration was filed and which version is in force', () => {
    renderCard({
      status: 'ok',
      declarations: [
        item({
          status: 'submitted',
          currentVersion: 2,
          reference: 'DCB-TSC-2027-0000001-B',
          submittedAt: '2026-09-30T09:00:00Z',
          late: false,
        }),
      ],
    });

    const row = screen.getByRole('listitem');
    expect(
      within(row).getByText('Statement date 1 Nov 2027 · Version 2 · Submitted 30 Sep 2026, 12:00'),
    ).toBeTruthy();
    // Wraps between the facts only, never inside the date.
    expect(row.textContent).toContain('Submitted\u00A030\u00A0Sep\u00A02026,\u00A012:00');
    expect(within(row).queryByText(/Saved/)).toBeNull();
    expect(within(row).queryByText('Filed late')).toBeNull();
  });

  it('says drafts save as you type only while there is one to continue', () => {
    const filed = item({
      id: 'b',
      status: 'submitted',
      currentVersion: 1,
      submittedAt: '2026-09-30T09:00:00Z',
    });
    const { unmount } = renderCard({ status: 'ok', declarations: [item(), filed] });
    expect(screen.getByText('Drafts save as you type. Continue where you left off.')).toBeTruthy();
    unmount();

    renderCard({ status: 'ok', declarations: [filed] });
    expect(screen.queryByText(/Drafts save as you type/)).toBeNull();
    expect(
      screen.getByText('Your filed declarations. Slips and amendments are on My declarations.'),
    ).toBeTruthy();
  });

  it('marks a submitted declaration filed after its due date', () => {
    renderCard({
      status: 'ok',
      declarations: [
        item({
          status: 'submitted',
          currentVersion: 1,
          submittedAt: '2028-01-02T09:00:00Z',
          late: true,
        }),
      ],
    });

    expect(within(screen.getByRole('listitem')).getByText('Filed late')).toBeTruthy();
  });

  it('says when an amendment was last saved, not when the version in force was filed', () => {
    renderCard({
      status: 'ok',
      declarations: [
        item({
          status: 'amending',
          currentVersion: 1,
          amendingFromVersion: 1,
          submittedAt: '2026-09-20T09:00:00Z',
        }),
      ],
    });

    expect(
      within(screen.getByRole('listitem')).getByText(
        'Statement date 1 Nov 2027 · Saved 27 Sep 2026, 11:15',
      ),
    ).toBeTruthy();
  });

  it('links to My declarations, where filed ones have their versions and amending', () => {
    renderCard({ status: 'ok', declarations: [item()] });

    expect(screen.getByRole('link', { name: 'My declarations' }).getAttribute('href')).toBe(
      '/declarations',
    );
  });

  it('says when there are no declarations yet', () => {
    renderCard({ status: 'ok', declarations: [] });
    expect(screen.queryByRole('link', { name: 'My declarations' })).toBeNull();

    expect(screen.getByRole('heading', { name: 'No declarations yet' })).toBeTruthy();
  });

  it('says when the list could not be loaded', () => {
    renderCard({ status: 'unavailable' });

    expect(
      screen.getByText('We could not load your declarations. Try again in a few minutes.'),
    ).toBeTruthy();
  });

  it('discards a draft after confirming and reloads the list', async () => {
    discardMock.mockResolvedValue({ status: 'discarded' });
    renderCard({ status: 'ok', declarations: [item()] });

    fireEvent.click(screen.getByRole('button', { name: 'Discard Biennial declaration' }));
    const dialog = screen.getByRole('dialog', { name: DISCARD_TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep draft' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(discardMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard Biennial declaration' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }),
      );
      await Promise.resolve();
    });

    expect(discardMock).toHaveBeenCalledWith({ data: { declarationId: DRAFT } });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText('Draft discarded')).toBeTruthy();
  });

  it('keeps the dialog open with the reason when discarding fails', async () => {
    discardMock.mockResolvedValue({ status: 'unavailable' });
    renderCard({ status: 'ok', declarations: [item()] });

    fireEvent.click(screen.getByRole('button', { name: 'Discard Biennial declaration' }));
    await act(async () => {
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard draft' }),
      );
      await Promise.resolve();
    });

    expect(
      within(screen.getByRole('dialog')).getByText(
        'We could not discard your draft. Try again in a few minutes.',
      ),
    ).toBeTruthy();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
