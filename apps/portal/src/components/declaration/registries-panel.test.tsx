// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptDeclarationSuggestion,
  dismissDeclarationSuggestion,
  getDeclarationSection,
  listDeclarationSuggestions,
  requestRegistryLookups,
  saveDeclarationSection,
} from '../../server/declarations';
import type {
  LoadedSection,
  LoadedSuggestion,
  LoadedSuggestionSet,
} from '../../server/declarations.server';
import type { DeclarationSection } from '../../server/declarations/types';
import { REGISTRY_COPY, type RegistryPerson } from './registries-panel';
import { StatementSection } from './statement-section';
import { DECLARATION_ID, renderWorkspace, sampleDeclaration, sections } from './testing';
import { navigate } from './testing-mocks';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const lookupsMock = vi.mocked(requestRegistryLookups);
const listMock = vi.mocked(listDeclarationSuggestions);
const acceptMock = vi.mocked(acceptDeclarationSuggestion);
const dismissMock = vi.mocked(dismissDeclarationSuggestion);
const getSectionMock = vi.mocked(getDeclarationSection);
const saveMock = vi.mocked(saveDeclarationSection);

const SPOUSE_ID = '11111111-2222-4333-8444-555555555555';
const SPOUSE_KEY = `statement:spouse:${SPOUSE_ID}`;
const FIELDER_ID = 'a0000000-0000-4000-8000-000000000009';
const NEW_ITEM = 'a0000000-0000-4000-8000-00000000000a';

const officer: RegistryPerson = {
  name: 'Mwangi Njoroge Kamau',
  firstName: 'Mwangi',
  nationalId: null,
  hasId: true,
};
const mary: RegistryPerson = {
  name: 'Mary Wanjiru Kennedy',
  firstName: 'Mary',
  nationalId: '23456789',
  hasId: true,
};

function statement(
  contents: Record<string, unknown> = {},
  key = 'statement:officer',
): LoadedSection {
  return {
    key,
    completeness: 'not-started',
    draftVersion: 1,
    issues: [],
    contents: {
      personKey: key.slice('statement:'.length),
      personName: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
      statementDate: '2027-11-01',
      incomePeriod: { from: '2025-11-01', to: '2027-11-01' },
      incomeNil: false,
      income: [],
      assetsNil: false,
      assets: [],
      liabilitiesNil: false,
      liabilities: [],
      ...contents,
    },
  };
}

let ids = 0;
function suggestion(overrides: Partial<LoadedSuggestion> = {}): LoadedSuggestion {
  ids += 1;
  return {
    id: `5a000000-0000-4000-8000-${String(ids).padStart(12, '0')}`,
    setId: 'ntsa',
    personKey: 'officer',
    sectionKey: 'statement:officer',
    itemType: 'vehicle',
    fields: { registration: 'KCA 123A', make: 'Toyota', model: 'Probox', year: 2016 },
    sourceRef: { registration: 'KCA 123A' },
    confidence: null,
    matchItemId: null,
    status: 'new',
    acceptedItemId: null,
    ...overrides,
  };
}

function set(
  source: LoadedSuggestionSet['source'],
  overrides: Partial<LoadedSuggestionSet> = {},
): LoadedSuggestionSet {
  return {
    id: source,
    personKey: 'officer',
    source,
    status: 'ready',
    requestedAt: '2026-09-26T07:30:00Z',
    readyAt: '2026-09-26T07:32:00Z',
    verificationResultId: null,
    aiJobId: null,
    suggestions: [],
    ...overrides,
  };
}

const probox = () => suggestion();
const fielder = () =>
  suggestion({
    fields: { registration: 'KDA 123X', make: 'Toyota', model: 'Fielder', year: 2014 },
    matchItemId: FIELDER_ID,
  });

function readySets(ntsa: LoadedSuggestion[] = [probox()]): LoadedSuggestionSet[] {
  return [
    set('kra'),
    set('ntsa', { suggestions: ntsa }),
    set('brs'),
    set('ardhisasa', { status: 'unavailable' }),
  ];
}

const householdSections: DeclarationSection[] = [
  { key: SPOUSE_KEY, completeness: 'not-started', updatedAt: null, personName: 'Mary Kennedy' },
];

function renderPanel({
  section = statement(),
  person = officer,
  sets = [] as LoadedSuggestionSet[],
} = {}) {
  return renderWorkspace(
    <StatementSection section={section} etag={'"1"'} registries={{ person, sets, pollMs: 5 }} />,
    {
      step: section.key,
      declaration: sampleDeclaration({ sections: sections({}, householdSections) }),
    },
  );
}

function registries() {
  return screen.getByRole('region', { name: /^Registries/ });
}

function strip() {
  return within(registries()).getByRole('list', { name: 'Registry status' });
}

function statusOf(name: string) {
  const row = within(strip())
    .getAllByRole('listitem')
    .find((item) => item.textContent.startsWith(name));
  if (!row) throw new Error(`No status for ${name}`);
  return row.textContent.slice(name.length);
}

/** The panel's own announcements (cards have their own status for saving). */
function announced() {
  return within(registries())
    .getAllByRole('status')
    .find((element) => element.tagName === 'P')?.textContent;
}

function suggestionCard(title: string) {
  return screen.getByRole('article', { name: title });
}

beforeEach(() => {
  lookupsMock.mockReset();
  listMock.mockReset();
  acceptMock.mockReset();
  dismissMock.mockReset();
  getSectionMock.mockReset();
  saveMock.mockReset();
  saveMock.mockReturnValue(new Promise(() => undefined));
  navigate.mockReset();
});

describe('Check registries: before a check', () => {
  it('offers the check per person, with the registries it asks', () => {
    renderPanel();

    expect(within(registries()).getByText(REGISTRY_COPY.registries)).toBeTruthy();
    const check = within(registries()).getByRole('button', { name: 'Check registries' });
    expect((check as HTMLButtonElement).disabled).toBe(false);
    expect(within(registries()).queryByRole('list', { name: 'Registry status' })).toBeNull();
  });

  it('is disabled with the reason for a person without a national ID', () => {
    renderPanel({
      section: statement({}, SPOUSE_KEY),
      person: { ...mary, nationalId: null, hasId: false },
    });

    const check = within(registries()).getByRole('button', { name: 'Check registries' });
    expect((check as HTMLButtonElement).disabled).toBe(true);
    const trigger = check.parentElement;
    expect(trigger?.getAttribute('tabindex')).toBe('0');
    expect(trigger?.getAttribute('aria-describedby')).toBeTruthy();
    expect(
      document.getElementById(trigger?.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe("Add Mary's national ID in Household to check registries.");
  });
});

describe('Check registries: consent and the status strip (S1, S2)', () => {
  it('asks for consent, checks every registry, and shows each status as it answers', async () => {
    const pending = ['kra', 'ntsa', 'brs', 'ardhisasa'].map((source) =>
      set(source as LoadedSuggestionSet['source'], { status: 'pending', readyAt: null }),
    );
    lookupsMock.mockResolvedValue({ status: 'started', sets: pending });
    listMock
      .mockResolvedValueOnce({
        status: 'ok',
        sets: [
          set('kra', { status: 'pending', readyAt: null }),
          set('ntsa', { status: 'pending', readyAt: null }),
          set('brs'),
          set('ardhisasa', { status: 'pending', readyAt: null }),
        ],
      })
      .mockResolvedValue({ status: 'ok', sets: readySets() });
    renderPanel({ section: statement({}, SPOUSE_KEY), person: mary });

    fireEvent.click(within(registries()).getByRole('button', { name: 'Check registries' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check registries' });
    expect(dialog.textContent).toContain(
      'Adili will ask KRA, NTSA, BRS and ArdhiSasa what they hold about Mary Wanjiru Kennedy (•••••789) and show the results to you only. Nothing is added unless you accept it.',
    );
    const proceed = within(dialog).getByRole('button', { name: 'Continue' });
    expect((proceed as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I request this check' }));
    fireEvent.click(proceed);

    await waitFor(() => {
      expect(statusOf('KRA')).toBe('Checking…');
    });
    expect(lookupsMock).toHaveBeenCalledWith({
      data: {
        declarationId: DECLARATION_ID,
        personKey: `spouse:${SPOUSE_ID}`,
        systems: ['kra', 'ntsa', 'brs', 'ardhisasa'],
        textVersion: 'registry-consent.v1',
        idempotencyKey: expect.any(String) as string,
      },
    });
    expect(within(registries()).getByText('Checking…', { selector: 'p' })).toBeTruthy();
    expect(within(registries()).getByRole('button', { name: 'Check again' })).toHaveProperty(
      'disabled',
      true,
    );

    await waitFor(() => {
      expect(statusOf('NTSA')).toBe('1 suggestion');
    });
    expect(statusOf('KRA')).toBe('Nothing found');
    expect(statusOf('BRS')).toBe('Nothing found');
    expect(statusOf('ArdhiSasa')).toBe('Not available nowRetry');
    expect(within(registries()).getByText('Checked 26 Sep 2026, 10:32')).toBeTruthy();
    await waitFor(() => {
      expect(announced()).toBe('Registry check finished for Mary Wanjiru Kennedy');
    });
    expect(listMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, personKey: `spouse:${SPOUSE_ID}` },
    });
  });

  it('leaves the masked ID out of the consent text for the officer', async () => {
    renderPanel();

    fireEvent.click(within(registries()).getByRole('button', { name: 'Check registries' }));
    const dialog = await screen.findByRole('dialog', { name: 'Check registries' });
    expect(dialog.textContent).toContain('what they hold about Mwangi Njoroge Kamau and show');
  });

  it('retries one unavailable registry without asking again', async () => {
    lookupsMock.mockResolvedValue({
      status: 'started',
      sets: [set('ardhisasa', { id: 'land-2', status: 'pending', readyAt: null })],
    });
    listMock.mockResolvedValue({ status: 'ok', sets: readySets() });
    renderPanel({ sets: readySets() });

    fireEvent.click(within(strip()).getByRole('button', { name: 'Retry ArdhiSasa' }));

    await waitFor(() => {
      expect(lookupsMock).toHaveBeenCalledTimes(1);
    });
    expect(lookupsMock.mock.calls[0]?.[0].data.systems).toEqual(['ardhisasa']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('disables the check when the service says the person has no national ID', async () => {
    lookupsMock.mockResolvedValue({ status: 'no-id' });
    renderPanel();

    fireEvent.click(within(registries()).getByRole('button', { name: 'Check registries' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'I request this check' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(within(registries()).getByRole('button', { name: 'Check registries' })).toHaveProperty(
        'disabled',
        true,
      );
    });
    expect(within(registries()).getByText(REGISTRY_COPY.noOwnId)).toBeTruthy();
  });
});

describe('Check registries: suggestion cards (S4, S5)', () => {
  it('groups cards by registry, counts those to review, and offers Add, Edit and add, Dismiss', () => {
    renderPanel({ sets: readySets([probox(), fielder()]) });

    expect(within(registries()).getByText('2 to review')).toBeTruthy();
    const group = within(registries()).getByRole('group', { name: 'From NTSA' });
    const card = within(group).getByRole('article', { name: 'KCA 123A · Toyota Probox 2016' });
    expect(card.textContent).toContain('From NTSA, 26 Sep 2026');
    expect(card.textContent).toContain('Vehicle · add the value yourself');
    expect(card.textContent).toContain('RegistrationKCA 123A');
    for (const action of ['Add', 'Edit and add', 'Dismiss']) {
      expect(
        within(card).getByRole('button', { name: `${action}: KCA 123A · Toyota Probox 2016` }),
      ).toBeTruthy();
    }
  });

  it('adds the item with the draft ETag, shows it in the statement and links to it', async () => {
    const accepted = { ...probox(), status: 'accepted' as const, acceptedItemId: NEW_ITEM };
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: accepted,
      itemId: NEW_ITEM,
      etag: '"2"',
    });
    getSectionMock.mockResolvedValue({
      status: 'ok',
      etag: '"2"',
      section: statement({
        assets: [
          {
            id: NEW_ITEM,
            type: 'vehicle',
            description: 'Toyota Probox',
            details: { registration: 'KCA 123A', makeModel: 'Toyota Probox, 2016' },
            location: { inKenya: true },
            change: { changed: false },
            joint: { isJoint: false },
          },
        ],
      }),
    });
    const sets = readySets([{ ...probox(), id: accepted.id }]);
    renderPanel({ sets });

    fireEvent.click(screen.getByRole('button', { name: 'Add: KCA 123A · Toyota Probox 2016' }));

    expect(await screen.findByText('Added. Enter its value.')).toBeTruthy();
    expect(acceptMock).toHaveBeenCalledWith({
      data: {
        declarationId: DECLARATION_ID,
        suggestionId: accepted.id,
        ifMatch: '"1"',
        fields: accepted.fields,
        applyToItemId: null,
      },
    });
    const card = suggestionCard('KCA 123A · Toyota Probox 2016');
    expect(card.textContent).toContain('Added');
    expect(screen.getByRole('tab', { name: /^Assets/ }).textContent).toContain('1 item');

    fireEvent.click(
      within(card).getByRole('button', { name: 'View: KCA 123A · Toyota Probox 2016' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /^Assets/ }).getAttribute('aria-selected')).toBe(
        'true',
      );
    });
    await waitFor(() => {
      expect(document.activeElement?.id).toContain(NEW_ITEM);
    });
  });

  it('refreshes the section and retries once when the draft changed underneath', async () => {
    const one = probox();
    acceptMock.mockResolvedValueOnce({ status: 'conflict', code: null }).mockResolvedValueOnce({
      status: 'accepted',
      suggestion: { ...one, status: 'accepted', acceptedItemId: NEW_ITEM },
      itemId: NEW_ITEM,
      etag: '"6"',
    });
    getSectionMock
      .mockResolvedValueOnce({ status: 'ok', etag: '"5"', section: statement() })
      .mockResolvedValue({ status: 'ok', etag: '"6"', section: statement() });
    renderPanel({ sets: readySets([one]) });

    fireEvent.click(screen.getByRole('button', { name: 'Add: KCA 123A · Toyota Probox 2016' }));

    expect(await screen.findByText('Section refreshed, then added')).toBeTruthy();
    expect(acceptMock).toHaveBeenCalledTimes(2);
    expect(acceptMock.mock.calls[1]?.[0].data.ifMatch).toBe('"5"');
  });

  it('says so and reads the suggestions again when the accept fails', async () => {
    const one = probox();
    acceptMock.mockResolvedValue({ status: 'conflict', code: 'not-new' });
    listMock.mockResolvedValue({
      status: 'ok',
      sets: readySets([{ ...one, status: 'dismissed' }]),
    });
    renderPanel({ sets: readySets([one]) });

    fireEvent.click(screen.getByRole('button', { name: 'Add: KCA 123A · Toyota Probox 2016' }));

    expect(await screen.findByText(REGISTRY_COPY.acceptFailed)).toBeTruthy();
    expect(acceptMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(within(registries()).getByRole('button', { name: 'Dismissed (1)' })).toBeTruthy();
    });
  });

  it('applies a match to the existing item, listing the empty fields it fills', async () => {
    const one = fielder();
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: { ...one, status: 'accepted', acceptedItemId: FIELDER_ID },
      itemId: FIELDER_ID,
      etag: '"2"',
    });
    getSectionMock.mockResolvedValue({ status: 'ok', etag: '"2"', section: statement() });
    const ours = {
      id: FIELDER_ID,
      type: 'vehicle',
      description: 'Our Fielder',
      details: { registration: 'KDA123X' },
      location: { inKenya: true },
      change: { changed: false },
      joint: { isJoint: false },
    };
    renderPanel({ section: statement({ assets: [ours] }), sets: readySets([one]) });

    const card = suggestionCard('KDA 123X · Toyota Fielder 2014');
    expect(card.textContent).toContain(
      'Matches "Our Fielder". Fills: Make and model Toyota Fielder, 2014',
    );
    // Adding it as a separate item stays possible, after the main action.
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Apply to this item', 'Add', 'Edit and add', 'Dismiss']);
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Apply to this item: KDA 123X · Toyota Fielder 2014',
      }),
    );

    await waitFor(() => {
      expect(suggestionCard('KDA 123X · Toyota Fielder 2014').textContent).toContain('Applied');
    });
    expect(acceptMock.mock.calls[0]?.[0].data.applyToItemId).toBe(FIELDER_ID);
  });

  it('still applies a match with nothing to fill, to record the registry as its source', async () => {
    const one = fielder();
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: { ...one, status: 'accepted', acceptedItemId: FIELDER_ID },
      itemId: FIELDER_ID,
      etag: '"2"',
    });
    getSectionMock.mockResolvedValue({ status: 'ok', etag: '"2"', section: statement() });
    const ours = {
      id: FIELDER_ID,
      type: 'vehicle',
      description: 'Our Fielder',
      details: { registration: 'KDA123X', makeModel: 'Toyota Fielder' },
      location: { inKenya: true },
      change: { changed: false },
      joint: { isJoint: false },
    };
    renderPanel({ section: statement({ assets: [ours] }), sets: readySets([one]) });

    const card = suggestionCard('KDA 123X · Toyota Fielder 2014');
    expect(card.textContent).toContain(
      'Matches "Our Fielder". Nothing to fill. Applying marks this item as confirmed by NTSA.',
    );
    expect(within(card).getAllByRole('button')[0]?.textContent).toBe('Apply to this item');
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Apply to this item: KDA 123X · Toyota Fielder 2014',
      }),
    );

    await waitFor(() => {
      expect(suggestionCard('KDA 123X · Toyota Fielder 2014').textContent).toContain('Applied');
    });
    expect(acceptMock.mock.calls[0]?.[0].data.applyToItemId).toBe(FIELDER_ID);
  });

  it('matches only the item the service names, not one it guesses', () => {
    const ours = {
      id: FIELDER_ID,
      type: 'vehicle',
      description: 'Our Probox',
      details: { registration: 'KCA 123A' },
      location: { inKenya: true },
      change: { changed: false },
      joint: { isJoint: false },
    };
    renderPanel({ section: statement({ assets: [ours] }), sets: readySets([probox()]) });

    const card = suggestionCard('KCA 123A · Toyota Probox 2016');
    expect(card.textContent).not.toContain('Matches');
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Add', 'Edit and add', 'Dismiss']);
  });

  it('adds with edited fields', async () => {
    const one = probox();
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: { ...one, status: 'accepted', acceptedItemId: NEW_ITEM },
      itemId: NEW_ITEM,
      etag: '"2"',
    });
    getSectionMock.mockResolvedValue({ status: 'ok', etag: '"2"', section: statement() });
    renderPanel({ sets: readySets([one]) });

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit and add: KCA 123A · Toyota Probox 2016' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit and add' });
    expect(dialog.textContent).toContain('From NTSA, 26 Sep 2026');
    const description = within(dialog).getByRole('textbox', { name: 'Description' });
    expect((description as HTMLInputElement).value).toBe('Toyota Probox');
    fireEvent.change(description, { target: { value: 'Family car' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => {
      expect(acceptMock).toHaveBeenCalledTimes(1);
    });
    expect(acceptMock.mock.calls[0]?.[0].data.fields).toEqual({
      registration: 'KCA 123A',
      make: 'Toyota',
      model: 'Probox',
      year: '2016',
      description: 'Family car',
    });
  });

  it('moves a dismissed card to the Dismissed fold', async () => {
    const one = probox();
    dismissMock.mockResolvedValue({
      status: 'dismissed',
      suggestion: { ...one, status: 'dismissed' },
    });
    renderPanel({ sets: readySets([one]) });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss: KCA 123A · Toyota Probox 2016' }));

    const fold = await within(registries()).findByRole('button', { name: 'Dismissed (1)' });
    expect(announced()).toBe('Dismissed KCA 123A · Toyota Probox 2016');
    expect(within(registries()).queryByRole('group', { name: 'From NTSA' })).toBeNull();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    const card = suggestionCard('KCA 123A · Toyota Probox 2016');
    expect(card.dataset.status).toBe('dismissed');
    expect(card.textContent).toContain('From NTSA');
    expect(card.textContent).toContain('Dismissed');
    expect(within(card).queryAllByRole('button')).toHaveLength(0);
  });

  it("shows the officer's KRA PIN without Apply", () => {
    const kra = suggestion({
      setId: 'kra',
      itemType: 'bio-tax',
      sectionKey: 'bio',
      fields: { kraPin: 'A005231876K', complianceStatus: 'compliant' },
    });
    renderPanel({ sets: [set('kra', { suggestions: [kra] })] });
    const title = 'KRA PIN A00•••••76K · Compliance: Compliant';
    const card = suggestionCard(title);
    expect(card.textContent).toContain('Shown in Your details');
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Dismiss']);
  });

  it("applies a spouse's KRA PIN and goes to Household from the accepted card", async () => {
    const kra = suggestion({
      setId: 'kra',
      personKey: `spouse:${SPOUSE_ID}`,
      itemType: 'bio-tax',
      sectionKey: 'household',
      fields: { kraPin: 'A006612874M', complianceStatus: 'compliant' },
    });
    acceptMock.mockResolvedValue({
      status: 'accepted',
      suggestion: { ...kra, status: 'accepted', acceptedItemId: SPOUSE_ID },
      itemId: SPOUSE_ID,
      etag: '"2"',
    });
    getSectionMock.mockResolvedValue({
      status: 'ok',
      etag: '"2"',
      section: {
        key: 'household',
        completeness: 'incomplete',
        draftVersion: 2,
        issues: [],
        contents: {},
      },
    });
    renderPanel({
      section: statement({}, SPOUSE_KEY),
      person: mary,
      sets: [set('kra', { personKey: `spouse:${SPOUSE_ID}`, suggestions: [kra] })],
    });
    const title = 'KRA PIN A00•••••74M · Compliance: Compliant';
    const card = suggestionCard(title);
    expect(card.textContent).toContain("Adds to Mary's details in Household");

    fireEvent.click(within(card).getByRole('button', { name: `Apply: ${title}` }));

    expect(await screen.findByText('Applied', { selector: 'span' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `View: ${title}` }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/declarations/$id/household',
      params: { id: DECLARATION_ID },
    });
  });
});
