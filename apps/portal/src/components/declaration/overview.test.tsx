// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DeclarationOverview } from './overview';
import { DECLARATION_ID, renderWorkspace, sampleDeclaration, sections } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const SPOUSE = 'statement:spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const GONE = 'statement:spouse:7b2e4d0a-3f4c-4e5d-9a6b-7c8d9e0f1a2b';

function rows() {
  const list = screen.getByRole('heading', { name: 'Sections' }).nextElementSibling;
  if (!(list instanceof HTMLElement)) throw new Error('no section list');
  return within(list).getAllByRole('listitem');
}

describe('DeclarationOverview', () => {
  it('shows a just-started draft with every section not started and Start', () => {
    renderWorkspace(<DeclarationOverview />);

    expect(screen.getByRole('heading', { level: 1, name: 'Your declaration' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '0% complete' })).toBeTruthy();
    expect(screen.getByText('4 sections left')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Start' }).getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}/bio`,
    );
    expect(rows().map((row) => row.textContent)).toEqual([
      '1Your detailsNot started',
      '2Spouses and childrenNot started',
      '3Financial statement: youNot started',
      '4Other informationNot started',
      'SummaryCheck and submit',
    ]);
    expect(screen.getByText('Only you can see your draft.')).toBeTruthy();
  });

  it('shows a half-way draft and continues at the first section not complete', () => {
    renderWorkspace(<DeclarationOverview />, {
      declaration: sampleDeclaration({
        sections: sections(
          { bio: 'complete', household: 'complete', 'statement:officer': 'incomplete' },
          [
            { key: SPOUSE, completeness: 'complete', updatedAt: null, personName: 'Mary Kamau' },
            { key: GONE, completeness: 'archived', updatedAt: null, personName: 'Jane Achieng' },
          ],
        ),
      }),
    });

    expect(screen.getByRole('heading', { name: '60% complete' })).toBeTruthy();
    expect(screen.getByText('2 sections left')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}/statements/officer`,
    );

    const spouse = screen.getByRole('link', { name: /Financial statement: Mary Kamau/ });
    expect(spouse.textContent).toContain('Spouse');
    expect(spouse.textContent).toContain('Complete');

    const archived = rows().find((row) => row.textContent.includes('Jane Achieng'));
    expect(archived?.textContent).toContain('Removed. Kept until you discard.');
    expect(archived?.textContent).toContain('Archived');
    expect(archived && within(archived).queryByRole('link')).toBeNull();
  });

  it('sends a complete draft to the summary', () => {
    renderWorkspace(<DeclarationOverview />, {
      declaration: sampleDeclaration({
        sections: sections({
          bio: 'complete',
          household: 'complete',
          'statement:officer': 'complete',
          other: 'complete',
        }),
      }),
    });

    expect(screen.getByRole('heading', { name: '100% complete' })).toBeTruthy();
    expect(screen.getByText('Check the summary, then submit.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to summary' }).getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}/summary`,
    );
  });
});
