// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeclaration, saveDeclarationSection } from '../../server/declarations';
import type { LoadedSection } from '../../server/declarations.server';
import type { DeclarationSection } from '../../server/declarations/types';
import type { MaritalStatus } from '../../declaration/contents';
import { HOUSEHOLD_MESSAGES } from '../../declaration/household';
import { HOUSEHOLD_COPY, HouseholdSection } from './household-section';
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
const getMock = vi.mocked(getDeclaration);

const MARY = '11111111-1111-4111-8111-111111111111';
const GRACE = '22222222-2222-4222-8222-222222222222';
const TOM = '33333333-3333-4333-8333-333333333333';
const LUCY = '44444444-4444-4444-8444-444444444444';
const ANN = '55555555-5555-4555-8555-555555555555';

const mary = {
  id: MARY,
  name: { surname: 'Kennedy', firstName: 'Mary', otherNames: 'Wanjiru' },
  nationalId: '23456789',
  occupationSector: 'public',
  separated: false,
};
const grace = {
  id: GRACE,
  name: { surname: 'Achieng', firstName: 'Grace' },
  occupationSector: 'private',
  separated: true,
  separationDate: '2024-03-01',
};
const tom = { id: TOM, name: { surname: 'Kamau', firstName: 'Tom' }, dateOfBirth: '2015-01-01' };
const lucy = { id: LUCY, name: { surname: 'Kamau', firstName: 'Lucy' }, dateOfBirth: '2012-06-30' };
// 18 on the statement date (S18): not included.
const ann = { id: ANN, name: { surname: 'Kamau', firstName: 'Ann' }, dateOfBirth: '2009-11-01' };

function household(contents: Record<string, unknown> = {}): LoadedSection {
  return {
    key: 'household',
    completeness: 'incomplete',
    draftVersion: 1,
    issues: [],
    contents: contents as LoadedSection['contents'],
  };
}

function renderHousehold(
  contents: Record<string, unknown> = {},
  {
    maritalStatus = 'married',
    showErrors = false,
    extra = [],
  }: {
    maritalStatus?: MaritalStatus | null;
    showErrors?: boolean;
    extra?: DeclarationSection[];
  } = {},
) {
  return renderWorkspace(
    <HouseholdSection
      section={household(contents)}
      etag={'"1"'}
      maritalStatus={maritalStatus}
      officerSurname="Kamau"
      showErrors={showErrors}
    />,
    { step: 'household', declaration: sampleDeclaration({ sections: sections({}, extra) }) },
  );
}

function card(name: string) {
  return cardOf(name, { level: 3 });
}

function statement(key: string, personName: string | null, completeness = 'not-started') {
  return {
    key,
    completeness,
    updatedAt: null,
    personName,
  } as DeclarationSection;
}

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockReturnValue(new Promise(() => undefined));
  getMock.mockReset();
});

describe('HouseholdSection', () => {
  it('lists spouses and children with who needs a statement (S5)', () => {
    renderHousehold({
      spouses: { none: false, items: [mary, grace] },
      children: { none: false, items: [tom, lucy, ann] },
    });

    const spouses = region('Spouses');
    expect(within(spouses).getByText(HOUSEHOLD_COPY.spousesHint)).toBeTruthy();
    expect(
      within(card('Mary Wanjiru Kennedy')).getByText('ID 23456789 · Public sector'),
    ).toBeTruthy();
    expect(
      within(card('Grace Achieng')).getByText(
        'No ID given · Private sector · Separated since 1 Mar 2024',
      ),
    ).toBeTruthy();
    expect(within(spouses).getByRole('button', { name: 'Add another spouse' })).toBeTruthy();
    expect(
      within(spouses).getByRole('button', { name: 'Remove Mary Wanjiru Kennedy' }),
    ).toBeTruthy();

    const children = region('Dependent children');
    expect(within(children).getByText('Under 18 on 1 Nov 2027')).toBeTruthy();
    expect(within(card('Tom Kamau')).getByText('Included: under 18 on 1 Nov 2027')).toBeTruthy();
    expect(within(card('Tom Kamau')).getByText('Born 01/01/2015')).toBeTruthy();
    expect(
      within(card('Ann Kamau')).getByText(
        'Not included: 18 on the statement date. No statement is required.',
      ),
    ).toBeTruthy();
    expect(within(children).getByRole('button', { name: 'Add another child' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: HOUSEHOLD_COPY.noChildrenCheckbox })).toBeNull();

    expect(
      screen.getByText('you, Mary Wanjiru Kennedy, Grace Achieng, Tom Kamau, Lucy Kamau', {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it('asks a married declarant to add a spouse or confirm none (S6)', async () => {
    vi.useFakeTimers();
    try {
      renderHousehold({}, { maritalStatus: 'married' });
      const spouses = region('Spouses');

      expect(within(spouses).getByRole('note')).toBeTruthy();
      expect(within(spouses).getByText(HOUSEHOLD_COPY.spouseUnanswered)).toBeTruthy();
      expect(within(spouses).getByRole('button', { name: 'Add a spouse' })).toBeTruthy();

      fireEvent.click(
        within(spouses).getByRole('checkbox', { name: HOUSEHOLD_COPY.noSpouseCheckbox }),
      );

      expect(
        within(spouses).getByRole<HTMLInputElement>('checkbox', {
          name: HOUSEHOLD_COPY.noSpouseCheckbox,
        }).checked,
      ).toBe(true);
      expect(within(spouses).queryByText(HOUSEHOLD_COPY.spouseUnanswered)).toBeNull();
      expect(within(spouses).queryByRole('button', { name: 'Add a spouse' })).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(saveMock).toHaveBeenCalledWith({
        data: {
          declarationId: DECLARATION_ID,
          sectionKey: 'household',
          ifMatch: '"1"',
          contents: { spouses: { none: true, items: [] } },
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no spouse to declare when single', () => {
    renderHousehold({}, { maritalStatus: 'single' });
    const spouses = region('Spouses');

    expect(within(spouses).getByText(HOUSEHOLD_COPY.noSpouse)).toBeTruthy();
    expect(within(spouses).getByText(/You said you are single\./)).toBeTruthy();
    expect(within(spouses).getByRole('link', { name: 'Your details' })).toBeTruthy();
    expect(within(spouses).queryByRole('button', { name: 'Add a spouse' })).toBeNull();
    expect(within(spouses).queryByRole('checkbox')).toBeNull();
  });

  it('asks for a marital status first when none is chosen', () => {
    renderHousehold({}, { maritalStatus: null });
    const spouses = region('Spouses');

    expect(within(spouses).getByText(/Choose your marital status in/)).toBeTruthy();
    expect(within(spouses).getByRole('link', { name: 'Your details' }).getAttribute('href')).toBe(
      `/declarations/${DECLARATION_ID}/bio`,
    );
  });

  it('blocks a spouse the marital status contradicts (S6)', () => {
    renderHousehold({ spouses: { none: false, items: [mary] } }, { maritalStatus: 'divorced' });

    expect(within(region('Spouses')).getByRole('alert').textContent).toBe(
      HOUSEHOLD_MESSAGES.spouseConflict('divorced'),
    );
    expect(card('Mary Wanjiru Kennedy')).toBeTruthy();
  });

  it('adds a spouse, opens the card and asks when separated', () => {
    renderHousehold({}, { maritalStatus: 'separated' });

    fireEvent.click(screen.getByRole('button', { name: 'Add a spouse' }));

    const editor = screen.getByRole('group', { name: 'Spouse 1' });
    expect(document.activeElement).toBe(within(editor).getByRole('textbox', { name: 'Surname' }));
    expect(within(editor).getByRole('textbox', { name: /Other names/ })).toBeTruthy();
    expect(within(editor).getByRole('textbox', { name: /National ID/ })).toBeTruthy();
    expect(within(editor).getByRole('textbox', { name: /KRA PIN/ })).toBeTruthy();
    expect(within(editor).getByRole('radio', { name: 'Not employed' })).toBeTruthy();
    expect(within(editor).queryByText(HOUSEHOLD_COPY.separatedHint)).toBeNull();

    fireEvent.change(within(editor).getByRole('textbox', { name: 'First name' }), {
      target: { value: 'Grace' },
    });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Surname' }), {
      target: { value: 'Achieng' },
    });
    fireEvent.click(within(editor).getByRole('checkbox', { name: HOUSEHOLD_COPY.separatedToggle }));

    const open = screen.getByRole('group', { name: 'Grace Achieng' });
    expect(within(open).getByText(HOUSEHOLD_COPY.separatedHint)).toBeTruthy();
    expect(within(open).getByRole('textbox', { name: 'Date of separation' })).toBeTruthy();
    expect(screen.queryByText(HOUSEHOLD_COPY.spouseUnanswered)).toBeNull();
  });

  it('flags a malformed ID or KRA PIN while typing', () => {
    renderHousehold({ spouses: { none: false, items: [mary] } });

    fireEvent.click(screen.getByRole('button', { name: 'Edit Mary Wanjiru Kennedy' }));
    const editor = screen.getByRole('group', { name: 'Mary Wanjiru Kennedy' });
    fireEvent.change(within(editor).getByRole('textbox', { name: /KRA PIN/ }), {
      target: { value: 'x12' },
    });

    const pin = within(editor).getByRole<HTMLInputElement>('textbox', { name: /KRA PIN/ });
    expect(pin.value).toBe('X12');
    expect(pin.getAttribute('aria-invalid')).toBe('true');
    expect(
      within(editor).getByText("Check Mary Wanjiru Kennedy's KRA PIN, e.g. A000000000Z."),
    ).toBeTruthy();
  });

  it('shows missing details on the cards and every missing answer when asked', () => {
    renderHousehold(
      {
        spouses: {
          none: false,
          items: [
            mary,
            { id: GRACE, name: { surname: 'Achieng', firstName: 'Grace' }, separated: true },
          ],
        },
        children: { none: false, items: [{ id: TOM, name: { surname: 'Kamau' } }] },
      },
      { showErrors: true },
    );

    // The first person to fix opens, with their fields marked.
    const editor = screen.getByRole('group', { name: 'Grace Achieng' });
    expect(
      within(editor).getByText('Enter the date you separated from Grace Achieng.'),
    ).toBeTruthy();
    expect(
      within(editor)
        .getByRole('textbox', { name: 'Date of separation' })
        .getAttribute('aria-invalid'),
    ).toBe('true');
    // Closed cards carry their first issue.
    expect(
      within(card('Child 1')).getByText("Enter Child 1's surname and first name."),
    ).toBeTruthy();
    expect(within(card('Child 1')).getByText(HOUSEHOLD_COPY.noDateOfBirth)).toBeTruthy();
    expect(within(card('Child 1')).getByText('Date of birth not entered')).toBeTruthy();
  });

  it('asks about children until one is added or none is confirmed', () => {
    renderHousehold({ spouses: { none: true, items: [] } }, { showErrors: true });
    const children = region('Dependent children');

    expect(within(children).getByRole('alert').textContent).toContain(
      HOUSEHOLD_COPY.childrenUnanswered,
    );
    fireEvent.click(
      within(children).getByRole('checkbox', { name: HOUSEHOLD_COPY.noChildrenCheckbox }),
    );

    expect(within(children).queryByRole('alert')).toBeNull();
    expect(within(children).queryByRole('button', { name: 'Add a child' })).toBeNull();
  });

  it('pre-fills a new child with the declarant surname', () => {
    renderHousehold({ spouses: { none: true, items: [] } });

    fireEvent.click(screen.getByRole('button', { name: 'Add a child' }));

    const editor = screen.getByRole('group', { name: 'Child 1' });
    expect(within(editor).getByRole<HTMLInputElement>('textbox', { name: 'Surname' }).value).toBe(
      'Kamau',
    );
    expect(within(editor).getByRole('textbox', { name: 'Date of birth' })).toBeTruthy();
    expect(within(card('Child 1')).getByText(HOUSEHOLD_COPY.noDateOfBirth)).toBeTruthy();
  });

  it('confirms before removing a person and keeps their statement', async () => {
    renderHousehold({
      spouses: { none: false, items: [mary] },
      children: { none: true, items: [] },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mary Wanjiru Kennedy' }));

    const dialog = screen.getByRole('dialog', { name: 'Remove Mary Wanjiru Kennedy?' });
    expect(within(dialog).getByText(HOUSEHOLD_COPY.removeBody)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card('Mary Wanjiru Kennedy')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Mary Wanjiru Kennedy' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
      await Promise.resolve();
    });

    expect(screen.queryByRole('heading', { name: 'Mary Wanjiru Kennedy' })).toBeNull();
    expect(screen.getByText(HOUSEHOLD_COPY.removedToast('Mary Wanjiru Kennedy'))).toBeTruthy();
    // Saved at once, so the statement is archived and the navigation catches up.
    expect(saveMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sectionKey: 'household',
        contents: { spouses: { none: false, items: [] }, children: { none: true, items: [] } },
      }) as unknown,
    });
  });

  it('removes an empty card without asking', () => {
    renderHousehold({ spouses: { none: false, items: [{ id: MARY, separated: false }] } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Spouse 1' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Spouse 1' })).toBeNull();
  });

  it('lists removed people whose statements are kept', () => {
    renderHousehold(
      { spouses: { none: true, items: [] }, children: { none: true, items: [] } },
      { extra: [statement(`statement:spouse:${MARY}`, 'Mary Wanjiru Kennedy', 'archived')] },
    );

    const removed = region(HOUSEHOLD_COPY.removedHeading);
    expect(within(removed).getByText(HOUSEHOLD_COPY.archived('Mary Wanjiru Kennedy'))).toBeTruthy();
  });

  it('refreshes the section navigation when a save archives a statement', async () => {
    const tomKey = `statement:child:${TOM}`;
    const before = sampleDeclaration({
      sections: sections({}, [statement(tomKey, 'Tom Kamau')]),
    });
    getMock.mockResolvedValue({
      status: 'ok',
      declaration: sampleDeclaration({
        draftVersion: 2,
        sections: sections({}, [statement(tomKey, 'Tom Kamau', 'archived')]),
      }),
      etag: '"2"',
    });
    saveMock.mockResolvedValue({
      status: 'saved',
      etag: '"2"',
      result: {
        key: 'household',
        completeness: 'incomplete',
        draftVersion: 2,
        issues: [],
        sectionsChanged: [{ key: tomKey, action: 'archived' }],
      },
    });
    renderWorkspace(
      <HouseholdSection
        section={household({ spouses: { none: true, items: [] }, children: { items: [tom] } })}
        etag={'"1"'}
        maritalStatus="married"
      />,
      { step: 'household', declaration: before },
    );
    const nav = screen.getByRole('navigation', { name: 'Declaration sections' });
    expect(within(nav).getByText('Tom Kamau')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Tom Kamau' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(getMock).toHaveBeenCalledWith({ data: { declarationId: DECLARATION_ID } });
    });
    await waitFor(() => {
      expect(within(nav).queryByText('Tom Kamau')).toBeNull();
    });
    expect(
      within(region(HOUSEHOLD_COPY.removedHeading)).getByText(HOUSEHOLD_COPY.archived('Tom Kamau')),
    ).toBeTruthy();
  });

  it('refreshes the section navigation when a save renames a person', async () => {
    const maryKey = `statement:spouse:${MARY}`;
    const before = sampleDeclaration({ sections: sections({}, [statement(maryKey, null)]) });
    getMock.mockResolvedValue({
      status: 'ok',
      declaration: sampleDeclaration({
        draftVersion: 2,
        sections: sections({}, [statement(maryKey, 'Mary Kennedy')]),
      }),
      etag: '"2"',
    });
    saveMock.mockResolvedValue({
      status: 'saved',
      etag: '"2"',
      result: {
        key: 'household',
        completeness: 'incomplete',
        draftVersion: 2,
        issues: [],
        sectionsChanged: [],
      },
    });
    renderWorkspace(
      <HouseholdSection
        section={household({
          spouses: { none: false, items: [{ id: MARY, name: {} }] },
          children: { none: true, items: [] },
        })}
        etag={'"1"'}
        maritalStatus="married"
      />,
      { step: 'household', declaration: before },
    );
    const nav = screen.getByRole('navigation', { name: 'Declaration sections' });
    expect(within(nav).getByText('Unnamed person')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Spouse 1' }));
    const editor = screen.getByRole('group', { name: 'Spouse 1' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'First name' }), {
      target: { value: 'Mary' },
    });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Surname' }), {
      target: { value: 'Kennedy' },
    });

    await waitFor(
      () => {
        expect(within(nav).getByText('Mary Kennedy')).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    expect(getMock).toHaveBeenCalledWith({ data: { declarationId: DECLARATION_ID } });
  });
});
