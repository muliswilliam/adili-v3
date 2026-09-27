// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedSection } from '../../server/declarations.server';
import type { CompletenessIssue } from '../../server/declarations/types';
import { saveDeclarationSection } from '../../server/declarations';
import { NO_MATERIAL_CHANGES } from './other';
import { OtherSection } from './other-section';
import { DECLARATION_ID, region, renderWorkspace, sampleDeclaration, sections } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const saveMock = vi.mocked(saveDeclarationSection);
const SPOUSE = 'spouse:5f0c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';

function issue(path: string, message: string): CompletenessIssue {
  return { sectionKey: 'other', path, code: 'required', message };
}

const UNANSWERED = [
  issue('/registrableInterests/dualCitizenship/holds', 'Say whether you hold another citizenship.'),
  issue(
    '/registrableInterests/dualCitizenship/pendingApplication',
    'Say whether you have a pending citizenship application.',
  ),
];

function otherSection(
  contents: Record<string, unknown> = {},
  issues: CompletenessIssue[] = UNANSWERED,
): LoadedSection {
  return {
    key: 'other',
    completeness: 'not-started',
    draftVersion: 1,
    issues,
    contents: { materialChanges: [], ...contents },
  };
}

function renderOther(section = otherSection(), showErrors = false) {
  return renderWorkspace(<OtherSection section={section} etag={'"1"'} showErrors={showErrors} />, {
    step: 'other',
    declaration: sampleDeclaration({
      sections: sections({}, [
        {
          key: `statement:${SPOUSE}`,
          completeness: 'complete',
          updatedAt: null,
          personName: 'Mary Wanjiru Kennedy',
        },
      ]),
    }),
  });
}

const COMPLETE = {
  materialChanges: [
    { personKey: 'officer', kind: 'marital-status', explanation: 'Married in April 2025.' },
    {
      personKey: SPOUSE,
      itemId: '2d1f0a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b',
      itemDescription: 'Plot in Kapsoya',
      kind: 'acquisition',
      explanation: 'Bought in March 2026.',
    },
  ],
  registrableInterests: {
    directorships: [{ company: 'Kapsoya Water Project Ltd', role: 'Director', remunerated: false }],
    memberships: [{ entity: 'Kapsoya Parents Welfare Group', kind: 'society' }],
    dualCitizenship: { holds: true, country: 'UG', pendingApplication: false },
    pendingCases: [
      { forum: 'Eldoret Chief Magistrate', reference: 'ELC 45 of 2025', nature: 'Boundary' },
    ],
  },
  freeText: 'The Kapsabet farm is being transferred to me.',
};

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockReturnValue(new Promise(() => undefined));
});

describe('OtherSection', () => {
  it('shows a fresh draft with nothing flagged and no interests added', () => {
    renderOther();

    expect(screen.getByRole('heading', { level: 1, name: 'Other information' })).toBeTruthy();
    expect(within(region('Material changes')).getByText(NO_MATERIAL_CHANGES)).toBeTruthy();
    expect(screen.getAllByText('None added.')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Add a directorship' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a membership' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a pending case' })).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
    expect(screen.getByText('0 / 4,000 characters')).toBeTruthy();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('lists the composed material changes with a link to edit each', () => {
    renderOther(otherSection(COMPLETE, []));

    const changes = within(region('Material changes')).getAllByRole('listitem');
    expect(changes.map((row) => row.querySelector('p')?.textContent)).toEqual([
      'You · Marital status: marital status changed · Married in April 2025.',
      'Mary Wanjiru Kennedy · Plot in Kapsoya: acquired · Bought in March 2026.',
    ]);
    const [marital, plot] = within(region('Material changes')).getAllByRole('link');
    expect(marital?.getAttribute('href')).toBe(`/declarations/${DECLARATION_ID}/bio`);
    expect(plot?.getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}/statements/${encodeURIComponent(SPOUSE)}`,
    );
  });

  it('shows a complete section with every interest filled in', () => {
    renderOther(otherSection(COMPLETE, []));

    const directorship = screen.getByRole('heading', { name: 'Directorship 1' }).closest('li');
    if (!directorship) throw new Error('no directorship card');
    expect(
      within(directorship).getByRole<HTMLInputElement>('textbox', { name: 'Company' }).value,
    ).toBe('Kapsoya Water Project Ltd');
    expect(within(directorship).getByRole<HTMLInputElement>('radio', { name: 'No' }).checked).toBe(
      true,
    );
    expect(screen.getByRole('heading', { name: 'Membership 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Pending case 1' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Country' }).value).toBe(
      'Uganda',
    );
    expect(screen.getByText('45 / 4,000 characters')).toBeTruthy();
    expect(screen.queryByText('None added.')).toBeNull();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('adds and removes interest cards named after their number', () => {
    renderOther();

    fireEvent.click(screen.getByRole('button', { name: 'Add a directorship' }));
    expect(screen.getByRole('heading', { name: 'Directorship 1' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add a directorship' }));
    expect(screen.getByRole('heading', { name: 'Directorship 2' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove directorship 2' }));
    expect(screen.queryByRole('heading', { name: 'Directorship 2' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Directorship 1' })).toBeTruthy();
  });

  it('asks for the country only when another citizenship is held', () => {
    renderOther();

    const holds = screen.getByRole('group', {
      name: 'Do you hold citizenship of another country?',
    });
    fireEvent.click(within(holds).getByRole('radio', { name: 'Yes' }));
    expect(screen.getByRole('combobox', { name: 'Country' })).toBeTruthy();

    fireEvent.click(within(holds).getByRole('radio', { name: 'No' }));
    expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
  });

  it('shows every issue when arriving from the summary and focuses the first', () => {
    renderOther(
      otherSection({ registrableInterests: { directorships: [{ company: 'Kapsoya' }] } }, [
        issue(
          '/registrableInterests/directorships/0',
          'Directorship 1: enter the company, your role and whether it is paid.',
        ),
        ...UNANSWERED,
      ]),
      true,
    );

    expect(
      screen.getByText('Directorship 1: enter the company, your role and whether it is paid.'),
    ).toBeTruthy();
    expect(screen.getByText('Say whether you hold another citizenship.')).toBeTruthy();
    expect(
      screen.getByText('Say whether you have a pending citizenship application.'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Role' }).getAttribute('aria-invalid')).toBe('true');
    expect(
      screen.getByRole('textbox', { name: 'Company' }).getAttribute('aria-invalid'),
    ).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Role' }));
  });

  it('shows a card issue only once the card has been left', () => {
    renderOther(
      otherSection({ registrableInterests: { memberships: [{}] } }, [
        issue(
          '/registrableInterests/memberships/0',
          'Membership 1: enter the name and the kind of body.',
        ),
      ]),
    );

    expect(screen.queryByText('Membership 1: enter the name and the kind of body.')).toBeNull();
    fireEvent.blur(screen.getByRole('textbox', { name: 'Entity' }));
    expect(screen.getByText('Membership 1: enter the name and the kind of body.')).toBeTruthy();
  });

  it('autosaves the section without the composed material changes', async () => {
    vi.useFakeTimers();
    try {
      renderOther(otherSection(COMPLETE, []));

      fireEvent.change(
        screen.getByRole('textbox', { name: 'Anything else that may be useful or relevant' }),
        { target: { value: 'Nothing more.' } },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(saveMock).toHaveBeenCalledTimes(1);
      const contents = saveMock.mock.calls[0]?.[0].data.contents;
      expect(contents).not.toHaveProperty('materialChanges');
      expect(contents).toMatchObject({
        freeText: 'Nothing more.',
        registrableInterests: COMPLETE.registrableInterests,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
