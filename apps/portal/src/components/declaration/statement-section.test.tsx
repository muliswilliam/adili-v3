// @vitest-environment jsdom
import { Icon, type IconProps } from '@adili/ui';
import { Car01Icon, File02Icon, Home01Icon } from '@hugeicons/core-free-icons';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDeclarationSection, saveDeclarationSection } from '../../server/declarations';
import type { LoadedSection } from '../../server/declarations.server';
import type { DeclarationSection } from '../../server/declarations/types';
import { resetExtractionAvailability, useExtractionEnabled } from './extraction-availability';
import { ITEM_MESSAGES } from '../../declaration/statement';
import type { ItemAttachmentSlot } from './statement-item-editor';
import {
  NIL_BLOCKED_COPY,
  NIL_COPY,
  SEPARATED_COPY,
  StatementSection,
  type StatementSectionProps,
} from './statement-section';
import { cardOf, DECLARATION_ID, renderWorkspace, sampleDeclaration, sections } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const saveMock = vi.mocked(saveDeclarationSection);
const getSectionMock = vi.mocked(getDeclarationSection);

const SPOUSE_ID = '11111111-2222-4333-8444-555555555555';
const CHILD_ID = '66666666-7777-4888-8999-000000000000';
const SPOUSE_KEY = `statement:spouse:${SPOUSE_ID}`;
const CHILD_KEY = `statement:child:${CHILD_ID}`;

const household: DeclarationSection[] = [
  {
    key: SPOUSE_KEY,
    completeness: 'not-started',
    updatedAt: null,
    personName: 'Mary Wanjiru Kennedy',
  },
  { key: CHILD_KEY, completeness: 'not-started', updatedAt: null, personName: 'Amani Kamau' },
];

const NAMES = {
  'statement:officer': { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
  [SPOUSE_KEY]: { surname: 'Kennedy', firstName: 'Mary', otherNames: 'Wanjiru' },
  [CHILD_KEY]: { surname: 'Kamau', firstName: 'Amani' },
};

function statement(
  contents: Record<string, unknown> = {},
  key: keyof typeof NAMES = 'statement:officer',
): LoadedSection {
  return {
    key,
    completeness: 'not-started',
    draftVersion: 1,
    issues: [],
    contents: {
      personKey: key.slice('statement:'.length),
      personName: NAMES[key],
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

const land = {
  id: 'a0000000-0000-4000-8000-000000000001',
  type: 'land',
  description: 'Quarter-acre residential plot, Kapsoya',
  details: { parcelNumber: 'Eldoret Municipality Block 7/1234' },
  value: { kesCents: 350_000_000 },
  location: { inKenya: true, county: '027' },
  joint: { isJoint: true, sharePercent: 50, coOwner: 'Spouse' },
  change: { changed: true, kind: 'acquisition', explanation: 'Bought in January 2026.' },
};

const shares = {
  id: 'a0000000-0000-4000-8000-000000000002',
  type: 'shareholding',
  description: 'Shares in a Kampala hardware business',
  details: { issuer: 'Kampala Hardware Ltd', quantityOrPercent: '5%' },
  value: { kesCents: 250_000_000, original: { currency: 'UGX', minorUnits: 70_000_000 } },
  location: { inKenya: false, country: 'UG' },
  joint: { isJoint: false },
  change: { changed: false },
};

/** A vehicle just added: no county and no value yet. */
const car = {
  id: 'a0000000-0000-4000-8000-000000000003',
  type: 'vehicle',
  description: 'Family car',
  location: { inKenya: true },
  joint: { isJoint: false },
};

const mortgage = {
  id: 'l0000000-0000-4000-8000-000000000001',
  type: 'mortgage',
  description: 'Mortgage on the Kapsoya house',
  creditor: 'HFC Bank',
  outstanding: { kesCents: 240_000_000 },
  location: { inKenya: true },
  change: { changed: true, kind: 'value-change' },
};

function renderStatement(
  section: LoadedSection = statement(),
  props: Partial<StatementSectionProps> = {},
  sectionList: DeclarationSection[] = household,
) {
  return renderWorkspace(<StatementSection section={section} etag={'"1"'} {...props} />, {
    step: section.key,
    declaration: sampleDeclaration({ sections: sections({}, sectionList) }),
  });
}

function tab(name: RegExp) {
  return screen.getByRole('tab', { name });
}

function openTab(name: RegExp) {
  fireEvent.mouseDown(tab(name), { button: 0 });
}

function panel() {
  return screen.getByRole('tabpanel');
}

function card(title: string) {
  return cardOf(title, { scope: panel() });
}

/** The drawing an icon renders, to tell icons apart. */
function drawingOf(icon: IconProps['icon']) {
  const { container, unmount } = render(<Icon icon={icon} />);
  const drawing = container.querySelector('svg')?.innerHTML;
  unmount();
  return drawing;
}

function precedes(a: Element, b: Element) {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

async function flushTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500);
  });
}

beforeEach(() => {
  resetExtractionAvailability();
  saveMock.mockReset();
  saveMock.mockReturnValue(new Promise(() => undefined));
  getSectionMock.mockReset();
});

describe('StatementSection: person and tabs', () => {
  it('heads the statement with the person, relationship and statement date, on Income', () => {
    renderStatement();

    expect(screen.getByText('Mwangi Njoroge Kamau · You')).toBeTruthy();
    expect(screen.getByText('Statement date 1 Nov 2027')).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Parts of the statement' })).toBeTruthy();
    expect(tab(/^Income/).getAttribute('aria-selected')).toBe('true');
    expect(within(panel()).getByText('Received 1 Nov 2025 to 1 Nov 2027.')).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: 'Add income' })).toBeTruthy();
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it('moves between tabs with the arrow keys', async () => {
    renderStatement();

    tab(/^Income/).focus();
    fireEvent.keyDown(tab(/^Income/), { key: 'ArrowRight' });

    await waitFor(() => {
      expect(tab(/^Assets/).getAttribute('aria-selected')).toBe('true');
    });
    expect(document.activeElement).toBe(tab(/^Assets/));
    expect(
      within(panel()).getByText('Owned on 1 Nov 2027, in Kenya or abroad, alone or jointly.'),
    ).toBeTruthy();
  });

  it('shows the item count on a tab, or a tick for nothing to declare', () => {
    renderStatement(statement({ assets: [land, shares], liabilitiesNil: true }));

    expect(tab(/^Assets/).textContent).toContain('2 items');
    expect(tab(/^Liabilities/).textContent).toContain('Nothing to declare');
    expect(tab(/^Income/).textContent).toBe('Income');
  });

  it('heads a child statement with the child and relationship', () => {
    renderStatement(statement({}, CHILD_KEY));

    expect(screen.getByText('Amani Kamau · Child')).toBeTruthy();
    expect(screen.queryByText(SEPARATED_COPY)).toBeNull();
  });

  it('tells a separated spouse statement to declare what is known', () => {
    renderStatement(statement({}, SPOUSE_KEY), { separated: true });

    expect(screen.getByText('Mary Wanjiru Kennedy · Spouse, separated')).toBeTruthy();
    expect(screen.getByText(SEPARATED_COPY)).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: /The extent of your knowledge of their affairs/ }),
    ).toBeTruthy();
  });
});

describe('StatementSection: your assets', () => {
  it('lists each asset with its details, tags and amount, and the total', () => {
    renderStatement(statement({ assets: [land, shares] }));
    openTab(/^Assets/);

    const plot = card('Land: Quarter-acre residential plot, Kapsoya');
    expect(
      within(plot).getByText('Eldoret Municipality Block 7/1234 · Uasin Gishu County'),
    ).toBeTruthy();
    expect(within(plot).getByText('Joint · my share 50%')).toBeTruthy();
    expect(within(plot).getByText('Changed: acquired')).toBeTruthy();
    expect(within(plot).getByText('KES 3,500,000')).toBeTruthy();
    expect(within(plot).getByText('whole value')).toBeTruthy();

    const abroad = card('Shareholding: Shares in a Kampala hardware business');
    expect(within(abroad).getByText('Outside Kenya · UGX 70,000,000')).toBeTruthy();

    expect(within(panel()).getByText('Total assets declared (KES estimates)')).toBeTruthy();
    expect(within(panel()).getByText('KES 6,000,000')).toBeTruthy();
  });

  it("shows each asset with its type's icon", () => {
    renderStatement(statement({ assets: [land, car] }));
    openTab(/^Assets/);

    const vehicle = card('Vehicle: Family car').querySelector('svg')?.innerHTML;
    expect(vehicle).toBe(drawingOf(Car01Icon));
    expect(vehicle).not.toBe(drawingOf(Home01Icon));
  });

  it('shows a neutral icon, not a house, for an asset of type Other', () => {
    renderStatement(
      statement({ assets: [{ ...car, type: 'other', description: 'Gold jewellery' }] }),
    );
    openTab(/^Assets/);

    const jewellery = card('Other: Gold jewellery').querySelector('svg')?.innerHTML;
    expect(jewellery).toBe(drawingOf(File02Icon));
    expect(jewellery).not.toBe(drawingOf(Home01Icon));
  });

  it('says an asset has no value yet instead of a dash', () => {
    renderStatement(statement({ assets: [car] }), { showErrors: true });
    openTab(/^Assets/);

    const vehicle = card('Vehicle: Family car');
    expect(within(vehicle).getByText('No value yet')).toBeTruthy();
    expect(within(vehicle).queryByText('-')).toBeNull();
    expect(within(vehicle).getByText(ITEM_MESSAGES.county)).toBeTruthy();
  });

  it('asks for the value of an asset missing only its value', () => {
    renderStatement(
      statement({ assets: [{ ...car, location: { inKenya: true, county: '047' } }] }),
      {
        showErrors: true,
      },
    );
    openTab(/^Assets/);

    const vehicle = card('Vehicle: Family car');
    expect(within(vehicle).getByText('No value yet')).toBeTruthy();
    expect(within(vehicle).getByText(ITEM_MESSAGES.amount.assets)).toBeTruthy();
  });

  it('S11: badges an item from a registry with its source, date and identifier', () => {
    const at = '2026-09-26T08:00:00Z';
    const suggestionId = '7d1f7a64-3c41-4c55-9d0e-6a9b1b3e2f10';
    renderStatement(
      statement({ assets: [{ ...land, source: { kind: 'ardhisasa', suggestionId, at } }, shares] }),
    );
    openTab(/^Assets/);

    const badge = within(card('Land: Quarter-acre residential plot, Kapsoya')).getByRole('img', {
      name: 'Source: From ArdhiSasa, 26 Sep 2026 · Eldoret Municipality Block 7/1234',
    });
    expect(badge.textContent).toBe('ArdhiSasa');
    expect(
      within(card('Shareholding: Shares in a Kampala hardware business')).queryByRole('img', {
        name: /^Source:/,
      }),
    ).toBeNull();
  });

  it('names every card action after the item', () => {
    renderStatement(statement({ assets: [land] }));
    openTab(/^Assets/);

    const title = 'Land: Quarter-acre residential plot, Kapsoya';
    expect(screen.getByRole('button', { name: `Edit ${title}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Remove ${title}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Also declare ${title} for…` })).toBeTruthy();
  });

  it('offers no copy to another person on income or liabilities', () => {
    renderStatement(statement({ liabilities: [{ ...mortgage, change: { changed: false } }] }));
    openTab(/^Liabilities/);

    expect(screen.queryByRole('button', { name: /^Also declare/ })).toBeNull();
  });
});

describe('StatementSection: item editors', () => {
  it('asks for the type of a new asset first', () => {
    renderStatement();
    openTab(/^Assets/);

    fireEvent.click(within(panel()).getByRole('button', { name: 'Add an asset' }));

    const types = screen.getByRole('group', { name: 'Type of asset' });
    expect(
      within(types)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual([
      'Land',
      'Building',
      'Vehicle',
      'Securities',
      'Shareholding',
      'Bank account',
      'Cash',
      'Money owed to me',
      'Other',
    ]);
    expect(screen.getByText('Choose a type first.')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
    expect(document.activeElement).toBe(within(types).getAllByRole('radio')[0]);
  });

  it('puts the type-specific fields right after the type, in DOM order', () => {
    renderStatement();
    openTab(/^Assets/);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add an asset' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Land' }));

    const type = screen.getByRole('group', { name: 'Type of asset' });
    const parcel = screen.getByRole('textbox', { name: 'Parcel or plot number' });
    const size = screen.getByRole('textbox', { name: /^Size/ });
    const description = screen.getByRole('textbox', { name: 'Description' });
    expect(precedes(type, parcel)).toBe(true);
    expect(precedes(parcel, size)).toBe(true);
    expect(precedes(size, description)).toBe(true);
    expect(screen.getByRole('combobox', { name: 'County' })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'Vehicle' }));
    expect(screen.queryByRole('textbox', { name: 'Parcel or plot number' })).toBeNull();
    const registration = screen.getByRole('textbox', { name: 'Registration' });
    expect(precedes(type, registration)).toBe(true);
    expect(precedes(registration, screen.getByRole('textbox', { name: 'Description' }))).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Bank account' }));
    expect(screen.getByRole('textbox', { name: 'Institution' })).toBeTruthy();
    expect(screen.getByText('Do not enter account numbers.')).toBeTruthy();
  });

  it('shows a jointly held land editor with my share and the co-owner', () => {
    renderStatement(statement({ assets: [land] }));
    openTab(/^Assets/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Land: Quarter-acre residential plot, Kapsoya' }),
    );

    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Jointly held' }).checked).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'My share' }).value).toBe('50');
    expect(screen.getByRole('combobox', { name: /Co-owner relationship/ }).textContent).toBe(
      'Spouse',
    );
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Parcel or plot number' }).value,
    ).toBe('Eldoret Municipality Block 7/1234');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Acquired' }).checked).toBe(true);
  });

  it('shows a shareholding outside Kenya with the country and original amount', () => {
    renderStatement(statement({ assets: [shares] }));
    openTab(/^Assets/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Edit Shareholding: Shares in a Kampala hardware business',
      }),
    );

    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Outside Kenya' }).checked).toBe(
      true,
    );
    expect(screen.getByRole<HTMLInputElement>('combobox', { name: 'Country' }).value).toBe(
      'Uganda',
    );
    expect(screen.queryByRole('combobox', { name: 'County' })).toBeNull();
    expect(screen.getByRole('combobox', { name: /Original currency/ }).textContent).toContain(
      'UGX',
    );
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Original amount/ }).value).toBe(
      '70,000,000',
    );
    expect(screen.getByText('No exact conversion needed.')).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Company or issuer' }).value).toBe(
      'Kampala Hardware Ltd',
    );
  });

  it('asks for the country of income from outside Kenya', () => {
    renderStatement();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add income' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Consultancy' }));

    expect(screen.queryByRole('combobox', { name: 'Country' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'This income is from outside Kenya' }));

    expect(screen.getByRole('combobox', { name: 'Country' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /Original amount/ })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Approximate amount for the period' })).toBeTruthy();
  });

  it('S19: refuses a negative amount with a field error instead of changing it', () => {
    renderStatement();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add income' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Consultancy' }));
    const amount = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Approximate amount for the period',
    });

    fireEvent.change(amount, { target: { value: '-3000' } });

    expect(amount.value).toBe('-3,000');
    expect(amount.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(ITEM_MESSAGES.negative)).toBeTruthy();
  });

  it('does not ask whether an item changed since the last declaration on an initial declaration', () => {
    renderWorkspace(
      <StatementSection section={statement({ liabilities: [mortgage] })} etag={'"1"'} />,
      {
        step: 'statement:officer',
        declaration: sampleDeclaration({ type: 'initial', sections: sections({}, household) }),
      },
    );
    openTab(/^Liabilities/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Mortgage: Mortgage on the Kapsoya house' }),
    );

    expect(screen.getByRole('textbox', { name: 'Creditor' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: /Changed since last declaration/ })).toBeNull();
  });

  it('shows a liability with its change flag and the liability kinds', () => {
    renderStatement(statement({ liabilities: [mortgage] }));
    openTab(/^Liabilities/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Mortgage: Mortgage on the Kapsoya house' }),
    );

    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: /Changed since last declaration/ })
        .checked,
    ).toBe(true);
    const kinds = screen.getByRole('group', { name: 'What changed?' });
    expect(
      within(kinds)
        .getAllByRole('radio')
        .map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['Value changed', 'New', 'Settled']);
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Creditor' }).value).toBe(
      'HFC Bank',
    );
  });

  it('saves a new liability as an acquisition', async () => {
    vi.useFakeTimers();
    try {
      renderStatement(statement({ liabilities: [mortgage] }));
      openTab(/^Liabilities/);
      fireEvent.click(
        screen.getByRole('button', { name: 'Edit Mortgage: Mortgage on the Kapsoya house' }),
      );
      fireEvent.click(screen.getByRole('radio', { name: 'New' }));
      await flushTimers();

      expect(saveMock).toHaveBeenCalledTimes(1);
      const contents = saveMock.mock.calls[0]?.[0].data.contents as {
        liabilities: { change: unknown }[];
      };
      expect(contents.liabilities[0]?.change).toEqual({ changed: true, kind: 'acquisition' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the item that needs an explanation when arriving with errors', () => {
    renderStatement(statement({ incomeNil: true, assetsNil: true, liabilities: [mortgage] }), {
      showErrors: true,
    });

    expect(tab(/^Liabilities/).getAttribute('aria-selected')).toBe('true');
    const explanation = screen.getByRole('textbox', { name: 'Explanation' });
    expect(explanation.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(ITEM_MESSAGES.explanation)).toBeTruthy();
    expect(document.activeElement).toBe(explanation);
  });

  it('shows what an item still needs once its editor is closed', () => {
    renderStatement();
    openTab(/^Assets/);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add an asset' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Cash' }));
    expect(screen.queryByText(ITEM_MESSAGES.description)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(within(card('Cash')).getByText(ITEM_MESSAGES.description)).toBeTruthy();
  });

  it('drops an item nothing was entered on when its editor is closed', () => {
    renderStatement();
    openTab(/^Assets/);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Add an asset' }));

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(within(panel()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('asks for the categories not answered when arriving with errors', () => {
    renderStatement(statement(), { showErrors: true });

    expect(
      within(panel()).getByText('Add at least one income item, or tick "Nothing to declare".'),
    ).toBeTruthy();
  });
});

describe('StatementSection: nothing to declare', () => {
  it('disables adding while nothing to declare is ticked, and says how to add', () => {
    renderStatement(statement({ liabilitiesNil: true }, SPOUSE_KEY));
    openTab(/^Liabilities/);

    const nil = within(panel()).getByRole<HTMLInputElement>('checkbox', {
      name: 'Nothing to declare',
    });
    expect(nil.checked).toBe(true);
    expect(nil.disabled).toBe(false);
    expect(within(panel()).getByText(NIL_COPY)).toBeTruthy();
    expect(
      within(panel()).getByRole<HTMLButtonElement>('button', { name: 'Add a liability' }).disabled,
    ).toBe(true);
  });

  it('disables nothing to declare while items exist', () => {
    renderStatement(statement({ assets: [land] }));
    openTab(/^Assets/);

    const nil = within(panel()).getByRole<HTMLInputElement>('checkbox', {
      name: 'Nothing to declare',
    });
    expect(nil.disabled).toBe(true);
    expect(within(panel()).getByText(NIL_BLOCKED_COPY)).toBeTruthy();
  });

  it('saves the nil flag with no items', async () => {
    vi.useFakeTimers();
    try {
      renderStatement();
      fireEvent.click(within(panel()).getByRole('checkbox', { name: 'Nothing to declare' }));
      await flushTimers();

      const contents = saveMock.mock.calls[0]?.[0].data.contents;
      expect(contents).toMatchObject({ incomeNil: true, income: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('StatementSection: remove', () => {
  it('confirms before removing an item', () => {
    renderStatement(statement({ assets: [land] }));
    openTab(/^Assets/);

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Land: Quarter-acre residential plot, Kapsoya' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Remove this asset?' });
    expect(dialog.textContent).toContain(
      'Land: Quarter-acre residential plot, Kapsoya will be removed from your statement.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(panel()).queryAllByRole('heading')).toHaveLength(0);
    expect(screen.getByText('Removed')).toBeTruthy();
  });

  it('keeps the item when the removal is cancelled', () => {
    renderStatement(statement({ liabilities: [mortgage] }, SPOUSE_KEY));
    openTab(/^Liabilities/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Mortgage: Mortgage on the Kapsoya house' }),
    );

    const dialog = screen.getByRole('dialog', { name: 'Remove this liability?' });
    expect(dialog.textContent).toContain("from Mary's statement.");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(card('Mortgage: Mortgage on the Kapsoya house')).toBeTruthy();
  });
});

describe('StatementSection: also declare for…', () => {
  const title = 'Land: Quarter-acre residential plot, Kapsoya';

  it('copies the asset to the spouse as jointly held with the other share', async () => {
    getSectionMock.mockResolvedValue({
      status: 'ok',
      etag: '"1"',
      section: statement({ assetsNil: true }, SPOUSE_KEY),
    });
    renderStatement(statement({ assets: [{ ...land, joint: { isJoint: false } }] }));
    openTab(/^Assets/);
    fireEvent.click(screen.getByRole('button', { name: `Also declare ${title} for…` }));

    const dialog = screen.getByRole('dialog', { name: 'Also declare for…' });
    expect(within(dialog).getByText(title)).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Mary Wanjiru Kennedy · Spouse' })
        .checked,
    ).toBe(true);
    expect(within(dialog).getByRole('radio', { name: 'Amani Kamau · Child' })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'My share' }), {
      target: { value: '60' },
    });
    expect(within(dialog).getByText('40%')).toBeTruthy();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add as jointly held' }));
      await Promise.resolve();
    });

    expect(getSectionMock).toHaveBeenCalledWith({
      data: { declarationId: DECLARATION_ID, sectionKey: SPOUSE_KEY },
    });
    const sent = saveMock.mock.calls[0]?.[0].data;
    expect(sent?.sectionKey).toBe(SPOUSE_KEY);
    expect(sent?.contents).toMatchObject({
      assetsNil: false,
      assets: [
        {
          type: 'land',
          description: land.description,
          value: land.value,
          joint: { isJoint: true, sharePercent: 40 },
          change: { changed: false },
        },
      ],
    });
    expect(screen.getByText("Added to Mary's statement as jointly held (40%)")).toBeTruthy();
    expect(within(card(title)).getByText('Joint · my share 60%')).toBeTruthy();
  });

  it('allows only a share between 1 and 99', () => {
    renderStatement(statement({ assets: [land] }));
    openTab(/^Assets/);
    fireEvent.click(screen.getByRole('button', { name: `Also declare ${title} for…` }));

    const dialog = screen.getByRole('dialog', { name: 'Also declare for…' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'My share' }), {
      target: { value: '100' },
    });

    expect(
      within(dialog).getByRole<HTMLButtonElement>('button', { name: 'Add as jointly held' })
        .disabled,
    ).toBe(true);
  });

  it('says to add a spouse or child first when there is no one else', () => {
    renderStatement(statement({ assets: [land] }), {}, []);
    openTab(/^Assets/);
    fireEvent.click(screen.getByRole('button', { name: `Also declare ${title} for…` }));

    const dialog = screen.getByRole('dialog', { name: 'Also declare for…' });
    expect(
      within(dialog).getByText('No one else to add it for. Add a spouse or child first.'),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Add as jointly held' })).toBeNull();
  });
});

describe('StatementSection: attachment slot', () => {
  // #681: a payslip is evidence for a salary (spec 05 story 28) and can be read into it (spec
  // 05b story 8), so income items take documents like assets and liabilities do.
  it('renders the slot in income, asset and liability editors', () => {
    const salaryId = 'i0000000-0000-4000-8000-000000000001';
    const renderAttachments = vi.fn(
      ({ itemId, itemNoun }: { itemId: string; itemNoun: string }) => (
        <p>{`Documents for ${itemNoun} ${itemId}`}</p>
      ),
    );
    renderStatement(
      statement({
        income: [
          {
            id: salaryId,
            type: 'salary-emoluments',
            description: 'Salary, KEMSA',
            amount: { kesCents: 100 },
            location: { inKenya: true },
            change: { changed: false },
          },
        ],
        assets: [land],
      }),
      { renderAttachments },
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Salary and emoluments: Salary, KEMSA' }),
    );
    expect(screen.getByText(`Documents for income item ${salaryId}`)).toBeTruthy();
    expect(renderAttachments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        category: 'income',
        itemId: salaryId,
        itemType: 'salary-emoluments',
      }),
    );

    openTab(/^Assets/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Land: Quarter-acre residential plot, Kapsoya' }),
    );
    expect(screen.getByText(`Documents for asset ${land.id}`)).toBeTruthy();
    expect(renderAttachments).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sectionKey: 'statement:officer',
        category: 'assets',
        itemId: land.id,
        attachments: [],
        disabled: false,
      }),
    );
  });

  it('gives the slot what Read into the form needs and merges the item it adds', () => {
    let slot: ItemAttachmentSlot | undefined;
    const renderAttachments = (given: ItemAttachmentSlot) => {
      slot = given;
      return null;
    };
    renderStatement(statement({ assets: [land] }), { renderAttachments });
    openTab(/^Assets/);
    fireEvent.click(
      screen.getByRole('button', { name: 'Edit Land: Quarter-acre residential plot, Kapsoya' }),
    );
    expect(slot).toMatchObject({ itemType: 'land', item: land });

    const added = {
      id: 'a0000000-0000-4000-8000-00000000000b',
      type: 'land',
      description: 'Land in Njoro',
      details: { parcelNumber: 'Nakuru/Njoro/1187' },
      location: { inKenya: true },
      change: { changed: false },
      joint: { isJoint: false },
      source: { kind: 'document', suggestionId: land.id, at: '2026-09-26T07:31:00Z' },
    };
    act(() => {
      slot?.onAccepted?.(added.id, { assets: [land, added] });
    });
    expect(screen.getByRole('button', { name: 'Edit Land: Land in Njoro' })).toBeTruthy();
  });

  it('remembers reading is off for the draft when a document set said so', () => {
    renderStatement(statement({ assets: [land] }), {
      registries: {
        person: { name: 'Mwangi Kamau', firstName: 'Mwangi', nationalId: null, hasId: true },
        sets: [
          {
            id: 'b0000000-0000-4000-8000-000000000001',
            personKey: 'officer',
            source: 'document',
            status: 'not-enabled',
            requestedAt: '2026-09-26T07:30:00Z',
            readyAt: '2026-09-26T07:30:00Z',
            verificationResultId: null,
            aiJobId: null,
            attachmentId: null,
            documentKind: null,
            reason: null,
            suggestions: [],
          },
        ],
      },
    });
    const { result } = renderHook(() => useExtractionEnabled(DECLARATION_ID));
    expect(result.current).toBe(false);
  });
});

describe('opening a field from Ask Adili', () => {
  it("opens the field's tab and item and focuses the field", async () => {
    renderStatement(statement({ assets: [land, { ...land, id: VEHICLE_ID, type: 'vehicle' }] }), {
      focusField: '/assets/1/value',
    });
    expect(tab(/Assets/).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement?.id).toBe(`item-${VEHICLE_ID}-amount`);
    });
  });

  it('opens the tab a category link names', async () => {
    renderStatement(statement({ liabilities: [mortgage] }), { focusField: '/liabilities' });
    expect(tab(/Liabilities/).getAttribute('aria-selected')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).toBe(tab(/Liabilities/));
    });
  });
});

const VEHICLE_ID = 'a0000000-0000-4000-8000-0000000000ff';
