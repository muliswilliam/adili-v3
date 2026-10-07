// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoadedSection } from '../../server/declarations.server';
import type { CompletenessIssue } from '../../server/declarations/types';
import { saveDeclarationSection } from '../../server/declarations';
import { NO_MATERIAL_CHANGES } from '../../declaration/other';
import { OtherSection } from './other-section';
import {
  cardOf,
  DECLARATION_ID,
  region,
  renderWorkspace,
  sampleDeclaration,
  sections,
} from './testing';

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

    // Cards are named after the item and closed until edited.
    const directorship = cardOf('Kapsoya Water Project Ltd');
    expect(within(directorship).getByText('Director · unpaid')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    expect(
      within(directorship).getByRole<HTMLInputElement>('textbox', { name: 'Company' }).value,
    ).toBe('Kapsoya Water Project Ltd');
    expect(within(directorship).getByRole<HTMLInputElement>('radio', { name: 'No' }).checked).toBe(
      true,
    );
    expect(within(cardOf('Kapsoya Parents Welfare Group')).getByText('Society')).toBeTruthy();
    expect(within(cardOf('ELC 45 of 2025')).getByText('Eldoret Chief Magistrate')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Country' }).value).toBe(
      'Uganda',
    );
    expect(screen.getByText('45 / 4,000 characters')).toBeTruthy();
    expect(screen.queryByText('None added.')).toBeNull();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('adds, edits, duplicates and removes interest cards named after the item', () => {
    renderOther();

    fireEvent.click(screen.getByRole('button', { name: 'Add a directorship' }));
    const editor = screen.getByRole('group', { name: 'Directorship 1' });
    expect(document.activeElement).toBe(within(editor).getByRole('textbox', { name: 'Company' }));
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Company' }), {
      target: { value: 'Kapsoya Water Ltd' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: 'Kapsoya Water Ltd' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Kapsoya Water Ltd' }));
    expect(screen.getAllByRole('heading', { name: 'Kapsoya Water Ltd' })).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Kapsoya Water Ltd' })).toBeTruthy();

    const [, removeCopy] = screen.getAllByRole('button', { name: 'Remove Kapsoya Water Ltd' });
    if (!removeCopy) throw new Error('no copy to remove');
    fireEvent.click(removeCopy);
    expect(screen.getAllByRole('heading', { name: 'Kapsoya Water Ltd' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Ltd' }));
    expect(screen.getByRole('group', { name: 'Kapsoya Water Ltd' })).toBeTruthy();
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

  it('does not flag an answer just given while its save is on the way', () => {
    renderOther();

    const holds = screen.getByRole('group', {
      name: 'Do you hold citizenship of another country?',
    });
    const no = within(holds).getByRole('radio', { name: 'No' });
    fireEvent.click(no);
    fireEvent.blur(no);

    // The loaded issues still say it is unanswered; the answer given since outranks them.
    expect(screen.queryByText('Say whether you hold another citizenship.')).toBeNull();
  });

  it('still flags a left field the declarant has not answered', () => {
    renderOther();

    const pending = screen.getByRole('group', {
      name: 'Do you have a pending application for citizenship of another country?',
    });
    fireEvent.blur(within(pending).getByRole('radio', { name: 'No' }));

    expect(
      screen.getByText('Say whether you have a pending citizenship application.'),
    ).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: 'Edit Membership 1' }));
    expect(screen.queryByText('Membership 1: enter the name and the kind of body.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      within(cardOf('Membership 1')).getByText(
        'Membership 1: enter the name and the kind of body.',
      ),
    ).toBeTruthy();
  });

  it('asks whether a directorship or membership changed since the last declaration', () => {
    renderOther(otherSection(COMPLETE, []));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    const directorship = screen.getByRole('group', { name: 'Kapsoya Water Project Ltd' });

    const changed = within(directorship).getByRole<HTMLInputElement>('checkbox', {
      name: /Changed since last declaration/,
    });
    expect(changed.checked).toBe(false);
    expect(within(directorship).queryByRole('group', { name: 'What changed?' })).toBeNull();

    fireEvent.click(changed);
    const kinds = within(directorship).getByRole('group', { name: 'What changed?' });
    expect(
      within(kinds)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['New', 'Changed', 'Ended']);
    fireEvent.click(within(kinds).getByRole('radio', { name: 'New' }));
    fireEvent.change(within(directorship).getByRole('textbox', { name: 'Explanation' }), {
      target: { value: 'Appointed in May 2026.' },
    });
    expect(within(kinds).getByRole<HTMLInputElement>('radio', { name: 'New' }).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Parents Welfare Group' }));
    const membership = screen.getByRole('group', { name: 'Kapsoya Parents Welfare Group' });
    expect(
      within(membership).getByRole('checkbox', { name: /Changed since last declaration/ }),
    ).toBeTruthy();
  });

  it('gives a membership its own example explanation', () => {
    renderOther(otherSection(COMPLETE, []));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Changed since last declaration/ }));
    expect(screen.getByRole('textbox', { name: 'Explanation' }).getAttribute('placeholder')).toBe(
      'e.g. Appointed to the board in May 2026.',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Parents Welfare Group' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Changed since last declaration/ }));
    expect(screen.getByRole('textbox', { name: 'Explanation' }).getAttribute('placeholder')).toBe(
      'e.g. Joined the group in March 2026.',
    );
  });

  it('shows the change on a closed directorship or membership card', () => {
    renderOther(
      otherSection(
        {
          registrableInterests: {
            ...COMPLETE.registrableInterests,
            directorships: [
              {
                company: 'Kapsoya Water Project Ltd',
                role: 'Director',
                remunerated: false,
                change: { changed: true, kind: 'acquisition', explanation: 'Appointed.' },
              },
            ],
            memberships: [
              {
                entity: 'Kapsoya Parents Welfare Group',
                kind: 'society',
                change: { changed: true },
              },
            ],
          },
        },
        [],
      ),
    );

    expect(
      within(cardOf('Kapsoya Water Project Ltd')).getByText('Director · unpaid · Changed: new'),
    ).toBeTruthy();
    expect(
      within(cardOf('Kapsoya Parents Welfare Group')).getByText(
        'Society · Changed: kind not chosen',
      ),
    ).toBeTruthy();
  });

  it('opens the flagged interest from its material change', () => {
    renderOther(
      otherSection(
        {
          materialChanges: [
            {
              personKey: 'officer',
              itemDescription: 'Kapsoya Parents Welfare Group',
              kind: 'membership',
              explanation: 'Joined in March 2026.',
            },
          ],
          registrableInterests: {
            ...COMPLETE.registrableInterests,
            memberships: [
              { entity: 'Kapsoya Youth Group', kind: 'society' },
              {
                entity: 'Kapsoya Parents Welfare Group',
                kind: 'society',
                change: {
                  changed: true,
                  kind: 'acquisition',
                  explanation: 'Joined in March 2026.',
                },
              },
            ],
          },
        },
        [],
      ),
    );

    expect(within(region('Material changes')).queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(
      within(region('Material changes')).getByRole('button', {
        name: 'Edit You · Kapsoya Parents Welfare Group: membership changed · Joined in March 2026.',
      }),
    );

    const membership = screen.getByRole('group', { name: 'Kapsoya Parents Welfare Group' });
    const changed = within(membership).getByRole('checkbox', {
      name: /Changed since last declaration/,
    });
    expect(document.activeElement).toBe(changed);
  });

  it('lists an interest flagged on this screen among the material changes', () => {
    renderOther(otherSection(COMPLETE, []));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Changed since last declaration/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'New' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Explanation' }), {
      target: { value: 'Appointed in May 2026.' },
    });

    expect(
      within(region('Material changes'))
        .getAllByRole('listitem')
        .map((item) => item.querySelector('p')?.textContent),
    ).toEqual([
      'You · Marital status: marital status changed · Married in April 2025.',
      'Mary Wanjiru Kennedy · Plot in Kapsoya: acquired · Bought in March 2026.',
      'You · Kapsoya Water Project Ltd: directorship changed · Appointed in May 2026.',
    ]);
  });

  it('opens the very card a change came from when two interests share a name', () => {
    const flagged = (explanation: string) => ({
      entity: 'Kapsoya Parents Welfare Group',
      kind: 'society',
      change: { changed: true, kind: 'acquisition', explanation },
    });
    renderOther(
      otherSection(
        {
          materialChanges: [],
          registrableInterests: {
            ...COMPLETE.registrableInterests,
            memberships: [flagged('Joined in 2020.'), flagged('Rejoined in March 2026.')],
          },
        },
        [],
      ),
    );

    fireEvent.click(
      within(region('Material changes')).getByRole('button', {
        name: 'Edit You · Kapsoya Parents Welfare Group: membership changed · Rejoined in March 2026.',
      }),
    );

    const membership = screen.getByRole('group', { name: 'Kapsoya Parents Welfare Group' });
    expect(
      within(membership).getByRole<HTMLTextAreaElement>('textbox', { name: 'Explanation' }).value,
    ).toBe('Rejoined in March 2026.');
    expect(document.activeElement).toBe(
      within(membership).getByRole('checkbox', { name: /Changed since last declaration/ }),
    );
  });

  it('does not ask whether an interest changed on an initial declaration', () => {
    renderWorkspace(<OtherSection section={otherSection(COMPLETE, [])} etag={'"1"'} />, {
      step: 'other',
      declaration: sampleDeclaration({ type: 'initial' }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));

    expect(screen.getByRole('textbox', { name: 'Company' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Changed since last declaration/ })).toBeNull();
  });

  it('shows what a flagged interest is missing once its card has been left', () => {
    renderOther(
      otherSection(
        {
          registrableInterests: {
            ...COMPLETE.registrableInterests,
            directorships: [
              {
                company: 'Kapsoya Water Project Ltd',
                role: 'Director',
                remunerated: false,
                change: { changed: true },
              },
            ],
          },
        },
        [
          issue(
            '/registrableInterests/directorships/0/change/kind',
            'Choose what changed since your last declaration.',
          ),
          issue(
            '/registrableInterests/directorships/0/change/explanation',
            'Explain what changed since your last declaration.',
          ),
        ],
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    expect(screen.queryByText('Choose what changed since your last declaration.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(
      within(cardOf('Kapsoya Water Project Ltd')).getByText(
        'Choose what changed since your last declaration.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Kapsoya Water Project Ltd' }));
    expect(screen.getByText('Choose what changed since your last declaration.')).toBeTruthy();
    expect(screen.getByText('Explain what changed since your last declaration.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Explanation' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
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
