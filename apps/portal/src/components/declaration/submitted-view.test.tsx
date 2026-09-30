// @vitest-environment jsdom
import { DCI, format } from '@adili/numbering/references';
import { ToastProvider } from '@adili/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { DeclarationVersion } from '../../server/declarations/types';
import { SubmittedView } from './submitted-view';
import { sampleDeclaration } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const REFERENCE = format(DCI, { issuer: 'PSC', period: 2026, sequence: 1 });

const declaration = sampleDeclaration({
  type: 'initial',
  statementDate: '2026-09-10',
  status: 'submitted',
  commission: { slug: 'psc', issuerCode: 'PSC', name: 'Public Service Commission' },
});

function versionOf(overrides: Partial<DeclarationVersion> = {}): DeclarationVersion {
  return {
    version: 1,
    reference: REFERENCE,
    submittedAt: '2026-09-30T07:42:00Z',
    late: false,
    canonicalSha256: 'a'.repeat(64),
    supersededAt: null,
    acknowledgement: {
      status: 'pending',
      documentId: null,
      verificationId: null,
      issuedAt: null,
      verifiedCount: 0,
      downloadUrl: null,
    },
    ...overrides,
  };
}

function renderSubmitted(version = versionOf(), reference = version.reference) {
  return render(
    <ToastProvider>
      <SubmittedView declaration={declaration} version={{ ...version, reference }} />
    </ToastProvider>,
  );
}

describe('the success page (spec 06 FE-3)', () => {
  it('says the declaration is submitted, with the reference, version and time', () => {
    renderSubmitted();

    expect(screen.getByRole('heading', { level: 1, name: 'Declaration submitted' })).toBeTruthy();
    expect(
      screen.getByText('Received by Public Service Commission. Keep your reference number.'),
    ).toBeTruthy();
    expect(screen.getByText(REFERENCE)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy reference number' })).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(screen.getByText('Submitted 30 Sep 2026, 10:42')).toBeTruthy();
    expect(screen.queryByText('Filed late')).toBeNull();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
  });

  it("explains the reference with the registry's type name and the Commission's name", () => {
    renderSubmitted();

    fireEvent.click(screen.getByRole('button', { name: 'What does this reference mean?' }));
    const breakdown = screen.getByRole('dialog', { name: 'How to read this reference' });
    const meanings = within(breakdown)
      .getAllByRole('definition')
      .map((meaning) => meaning.textContent);
    expect(meanings).toEqual([
      'Initial declaration',
      'Public Service Commission',
      'Year of the statement date',
      'Number within that Commission and year',
      'Catches typing mistakes',
    ]);
  });

  it('offers no breakdown for a reference it cannot read', () => {
    renderSubmitted(versionOf(), 'XYZ-1');

    expect(screen.getByText('XYZ-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'What does this reference mean?' })).toBeNull();
  });

  it('marks a late filing', () => {
    renderSubmitted(versionOf({ late: true }));

    expect(screen.getByText('Filed late')).toBeTruthy();
  });

  it('names the version an amendment replaces', () => {
    renderSubmitted(versionOf({ version: 2 }));

    expect(screen.getByText('Version 2')).toBeTruthy();
    expect(
      screen.getByText(
        'Received by Public Service Commission, replacing version 1. Keep your reference number.',
      ),
    ).toBeTruthy();
  });

  it('says the acknowledgement slip is being prepared, politely announced', () => {
    renderSubmitted();

    const status = screen
      .getByText('Preparing your acknowledgement slip…')
      .closest('[role="status"]');
    if (!(status instanceof HTMLElement)) throw new Error('No slip status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(
      within(status).getByText('Usually a few seconds. We also email it to you.'),
    ).toBeTruthy();
  });
});
