import { describe, expect, it } from 'vitest';

import type { AssetItem, Draft, IncomeItem, LiabilityItem, Statement } from './contents';
import {
  addJointCopy,
  centsToMinorUnits,
  firstItemIssue,
  isBlankItem,
  ITEM_MESSAGES,
  itemIssues,
  itemSummary,
  jointCopy,
  minorUnitsDigits,
  minorUnitsToCents,
  newItem,
  statementTotal,
  tabState,
  withCurrency,
} from './statement';
import { CHANGE_KIND_OPTIONS } from './labels';

const land: Draft<AssetItem> = {
  id: 'a1',
  type: 'land',
  description: 'Quarter-acre residential plot, Kapsoya',
  details: { parcelNumber: 'Eldoret Municipality Block 7/1234', size: '0.25 acres' },
  value: { kesCents: 350_000_000 },
  location: { inKenya: true, county: '027' },
  joint: { isJoint: false },
  change: { changed: false },
};

describe('newItem', () => {
  it('starts every item in Kenya, unchanged and, for assets, not joint', () => {
    const asset = newItem('assets');
    expect(asset.location).toEqual({ inKenya: true });
    expect(asset.change).toEqual({ changed: false });
    expect((asset as Draft<AssetItem>).joint).toEqual({ isJoint: false });
    expect(asset.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(newItem('income')).not.toHaveProperty('joint');
  });
});

describe('itemIssues', () => {
  it('asks for a type first, then the description and amount', () => {
    expect(itemIssues('income', newItem('income'))).toEqual({
      type: ITEM_MESSAGES.type,
      description: ITEM_MESSAGES.description,
      amount: ITEM_MESSAGES.amount.income,
    });
  });

  it('accepts a complete land asset with a county and parcel', () => {
    expect(itemIssues('assets', land)).toEqual({});
  });

  it('asks for the county of an asset in Kenya and the country of one abroad', () => {
    expect(itemIssues('assets', { ...land, location: { inKenya: true } }).county).toBe(
      ITEM_MESSAGES.county,
    );
    expect(itemIssues('assets', { ...land, location: { inKenya: false } }).country).toBe(
      ITEM_MESSAGES.country,
    );
  });

  it('asks for the country of income or a liability outside Kenya, never a county', () => {
    const income: Draft<IncomeItem> = {
      id: 'i1',
      type: 'rent',
      description: 'Rent from 2 units',
      amount: { kesCents: 100 },
      location: { inKenya: true },
      change: { changed: false },
    };
    expect(itemIssues('income', income)).toEqual({});
    expect(itemIssues('income', { ...income, location: { inKenya: false } })).toEqual({
      country: ITEM_MESSAGES.country,
    });
  });

  it('asks who a liability is owed to', () => {
    const loan: Draft<LiabilityItem> = {
      id: 'l1',
      type: 'loan',
      description: 'SACCO loan',
      outstanding: { kesCents: 5_000_00 },
      location: { inKenya: true },
      change: { changed: false },
    };
    expect(itemIssues('liabilities', loan)).toEqual({ creditor: ITEM_MESSAGES.creditor });
    expect(itemIssues('liabilities', { ...loan, creditor: 'Mwalimu SACCO' })).toEqual({});
  });

  it('takes a zero amount but not a missing one', () => {
    expect(itemIssues('assets', { ...land, value: { kesCents: 0 } })).toEqual({});
    expect(itemIssues('assets', { ...land, value: {} }).amount).toBe(ITEM_MESSAGES.amount.assets);
  });

  it('needs both halves of an original amount when either is given', () => {
    expect(
      itemIssues('assets', { ...land, value: { kesCents: 1, original: { currency: 'USD' } } })
        .originalAmount,
    ).toBe(ITEM_MESSAGES.originalAmount);
    expect(
      itemIssues('assets', { ...land, value: { kesCents: 1, original: { minorUnits: 500 } } })
        .originalCurrency,
    ).toBe(ITEM_MESSAGES.originalCurrency);
  });

  it('asks for a share from 1 to 100 on a jointly held asset', () => {
    expect(itemIssues('assets', { ...land, joint: { isJoint: true } }).share).toBe(
      ITEM_MESSAGES.share,
    );
    expect(itemIssues('assets', { ...land, joint: { isJoint: true, sharePercent: 0 } }).share).toBe(
      ITEM_MESSAGES.share,
    );
    expect(itemIssues('assets', { ...land, joint: { isJoint: true, sharePercent: 50 } })).toEqual(
      {},
    );
  });

  it('asks what changed and why when the change flag is on (S9)', () => {
    expect(itemIssues('assets', { ...land, change: { changed: true } })).toEqual({
      changeKind: ITEM_MESSAGES.changeKind,
      explanation: ITEM_MESSAGES.explanation,
    });
    expect(
      itemIssues('assets', {
        ...land,
        change: { changed: true, kind: 'acquisition', explanation: '   ' },
      }),
    ).toEqual({ explanation: ITEM_MESSAGES.explanation });
  });

  it('names the first issue in screen order', () => {
    expect(firstItemIssue('assets', { ...land, description: '', change: { changed: true } })).toBe(
      ITEM_MESSAGES.description,
    );
    expect(firstItemIssue('assets', land)).toBeNull();
  });
});

describe('isBlankItem', () => {
  it('is blank until a type, description or amount is given', () => {
    expect(isBlankItem('assets', newItem('assets'))).toBe(true);
    expect(isBlankItem('assets', { ...newItem('assets'), type: 'cash' })).toBe(false);
    expect(isBlankItem('income', { ...newItem('income'), amount: { kesCents: 0 } })).toBe(false);
  });
});

describe('change kinds', () => {
  it('offers the spec kinds per category', () => {
    expect(CHANGE_KIND_OPTIONS.income.map((option) => option.label)).toEqual([
      'Value changed by 25% or more',
      'New source',
      'Source ended',
    ]);
    expect(CHANGE_KIND_OPTIONS.assets.map((option) => option.value)).toEqual([
      'value-change',
      'acquisition',
      'disposal',
    ]);
  });

  it('maps a new liability to acquisition, the schema has no liability-specific kind', () => {
    expect(CHANGE_KIND_OPTIONS.liabilities).toEqual([
      { value: 'value-change', label: 'Value changed' },
      { value: 'acquisition', label: 'New' },
      { value: 'settled', label: 'Settled' },
    ]);
  });
});

describe('original currency amounts', () => {
  it('knows how many minor units a currency has', () => {
    expect(minorUnitsDigits('USD')).toBe(2);
    expect(minorUnitsDigits('UGX')).toBe(0);
    expect(minorUnitsDigits('KWD')).toBe(3);
  });

  it('converts an amount typed with up to two decimals to minor units and back', () => {
    expect(centsToMinorUnits(1_250_50, 'USD')).toBe(1_250_50);
    expect(centsToMinorUnits(500_000_00, 'UGX')).toBe(500_000);
    expect(centsToMinorUnits(12_50, 'KWD')).toBe(12_500);
    expect(minorUnitsToCents(500_000, 'UGX')).toBe(500_000_00);
    expect(minorUnitsToCents(12_500, 'KWD')).toBe(12_50);
  });

  it('keeps the typed amount when the currency changes', () => {
    const money = { kesCents: 1, original: { currency: 'USD', minorUnits: 20_00 } };
    expect(withCurrency(money, 'UGX')).toEqual({
      kesCents: 1,
      original: { currency: 'UGX', minorUnits: 20 },
    });
    expect(withCurrency({ kesCents: 1 }, 'EUR')).toEqual({
      kesCents: 1,
      original: { currency: 'EUR' },
    });
  });
});

describe('itemSummary', () => {
  it('lists the description and the type-specific details', () => {
    expect(itemSummary('assets', land)).toEqual([
      'Quarter-acre residential plot, Kapsoya',
      'Eldoret Municipality Block 7/1234',
      'Uasin Gishu County',
    ]);
    expect(
      itemSummary('assets', {
        type: 'shareholding',
        description: 'Shares',
        details: { issuer: 'Acme Ltd', quantityOrPercent: '5%' },
        location: { inKenya: false, country: 'UG' },
      }),
    ).toEqual(['Shares', 'Acme Ltd, 5%', 'Uganda']);
    expect(
      itemSummary('liabilities', {
        type: 'mortgage',
        description: 'Mortgage on the Kapsoya house',
        creditor: 'HFC Bank',
        location: { inKenya: true },
      }),
    ).toEqual(['Mortgage on the Kapsoya house', 'HFC Bank']);
    expect(
      itemSummary('assets', { type: 'receivable', details: { debtor: 'Peter' }, location: {} }),
    ).toEqual(['Owed by Peter']);
  });
});

describe('statementTotal', () => {
  it('adds the KES amounts and says when some are estimates of foreign amounts', () => {
    const statement: Draft<Statement> = {
      assets: [
        land,
        { ...land, id: 'a2', value: { kesCents: 50_00 }, location: { inKenya: false } },
      ],
    };
    expect(statementTotal(statement, 'assets')).toEqual({ cents: 350_005_000, abroad: true });
    expect(statementTotal({}, 'income')).toEqual({ cents: 0, abroad: false });
  });
});

describe('tabState', () => {
  it('shows the count, or nothing to declare', () => {
    expect(tabState({ assets: [land] }, 'assets')).toEqual({ count: 1, nil: false });
    expect(tabState({ liabilitiesNil: true, liabilities: [] }, 'liabilities')).toEqual({
      count: 0,
      nil: true,
    });
  });
});

describe('jointCopy and addJointCopy (story 30)', () => {
  it('makes the source joint and the copy joint with the other share, without documents or change', () => {
    const source: Draft<AssetItem> = {
      ...land,
      change: { changed: true, kind: 'acquisition', explanation: 'Bought' },
      attachments: [{ attachmentId: 'a', uploadId: 'u', fileName: 'deed.pdf', sha256: 'a'.repeat(64) }],
    };
    const { source: updated, copy } = jointCopy(source, 60);

    expect(updated.joint).toEqual({ isJoint: true, sharePercent: 60 });
    expect(updated.attachments).toHaveLength(1);
    expect(copy.id).not.toBe(source.id);
    expect(copy.joint).toEqual({ isJoint: true, sharePercent: 40 });
    expect(copy.change).toEqual({ changed: false });
    expect(copy.attachments).toBeUndefined();
    expect(copy.value).toEqual(land.value);
    expect(copy.description).toBe(land.description);
  });

  it('adds the copy to the other statement and clears its nothing to declare', () => {
    const target: Draft<Statement> = { assetsNil: true, assets: [] };
    const { copy } = jointCopy(land, 50);
    expect(addJointCopy(target, copy)).toEqual({ assetsNil: false, assets: [copy] });
  });
});
