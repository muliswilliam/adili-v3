import { describe, expect, it } from 'vitest';

import {
  MOCK_ATTACHMENTS,
  MOCK_DECLARATION,
  MOCK_ITEM_IDS as I,
} from '../server/review/copilot-mock.server';
import { itemLabel, personName, readDeclaration, statementFor } from './declaration';

describe('readDeclaration', () => {
  const view = readDeclaration(MOCK_DECLARATION);
  if (!view) throw new Error('the mock declaration should read');

  it('reads every statement in order with its items, nil categories and totals', () => {
    expect(view.statements.map((each) => [each.name, each.relationLabel])).toEqual([
      ['John Kennedy Otieno', 'Declarant'],
      ['Lilian Akoth Otieno', 'Spouse'],
      ['Brenda Otieno', 'Child'],
    ]);
    const officer = view.statements[0];
    expect(officer?.items.assets.map((item) => item.type)).toEqual([
      'Land',
      'Building',
      'Securities',
      'Shareholding',
    ]);
    expect(officer?.totals).toEqual({
      income: 360_000_000,
      assets: 1_635_000_000,
      liabilities: 340_000_000,
    });
    expect(view.statements[2]?.nil).toEqual({ income: true, assets: false, liabilities: true });
    expect(view.totals).toEqual({
      income: 456_000_000,
      assets: 1_682_000_000,
      liabilities: 340_000_000,
    });
  });

  it('puts place, ownership and the change mark in words', () => {
    const items = view.statements[0]?.items;
    expect(items?.assets[1]?.detail).toBe('Milimani, Kisumu · Joint, 50% share');
    expect(items?.assets[3]?.detail).toBe('Kampala, Uganda · Sole');
    expect(items?.income[1]?.changeMark).toBe('Marked as a new source');
    expect(items?.income[0]?.changeMark).toBeNull();
    // The creditor is left out when the description already names it.
    expect(items?.liabilities[0]?.detail).toBe('Kisumu');
  });

  it('names a county from the code the portal stores (e2e 04, 07)', () => {
    const view = readDeclaration({
      schemaVersion: 'declaration.v1',
      statements: [
        {
          personKey: 'officer',
          personName: { firstName: 'Wanjiku' },
          assets: [
            {
              id: 'a',
              type: 'land',
              description: 'Residential plot with two-bedroom flat, Ruaka',
              location: { inKenya: true, county: '022' },
              joint: { isJoint: true, sharePercent: 60 },
            },
            { id: 'b', type: 'land', location: { inKenya: true, county: '999' } },
          ],
        },
      ],
    });
    const assets = view?.statements[0]?.items.assets;
    expect(assets?.[0]?.detail).toBe('Kiambu · Joint, 60% share');
    // A code we do not know is shown as given.
    expect(assets?.[1]?.detail).toContain('999');
  });

  it('lists the attachments with the items they belong to', () => {
    expect(view.attachments.map((each) => [each.uploadId, each.label])).toEqual([
      [
        MOCK_ATTACHMENTS.titleDeed.uploadId,
        'Land · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
      ],
      [
        MOCK_ATTACHMENTS.valuation.uploadId,
        'Building · Three-bedroom house in Milimani · John Kennedy Otieno',
      ],
      [
        MOCK_ATTACHMENTS.saccoStatement.uploadId,
        'Shareholding · Shares in Mwalimu National SACCO · John Kennedy Otieno',
      ],
    ]);
  });

  it('reads personal details, household and other information in First Schedule terms', () => {
    expect(view.personal.find((field) => field.label === 'Date of birth')?.value).toBe(
      '4 May 1979',
    );
    expect(view.personal.find((field) => field.label === 'Nature of employment')?.value).toBe(
      'Permanent',
    );
    expect(view.spouses).toEqual([
      expect.objectContaining({ name: 'Lilian Akoth Otieno', line: 'National ID declared' }),
    ]);
    expect(view.children[0]?.line).toBe('Born 14 Feb 2012 · no national ID');
    expect(view.otherInformation).toHaveLength(1);
    expect(view.declaredAt).toBe('2026-03-28T07:42:00.000Z');
  });

  it('names an item where it sits, and finds a statement by person', () => {
    expect(itemLabel(view, I.plot)).toBe(
      'Assets · Land · Plot Kisumu/Manyatta/1234 · John Kennedy Otieno',
    );
    expect(itemLabel(view, 'nothing')).toBeNull();
    expect(statementFor(view, 'officer')?.name).toBe('John Kennedy Otieno');
  });

  it('reads nothing that is not a declaration.v1 document', () => {
    expect(readDeclaration(null)).toBeNull();
    expect(readDeclaration({ schemaVersion: 'form-m.v1' })).toBeNull();
  });

  it('tolerates missing parts and leaves out items without an id', () => {
    const view = readDeclaration({
      schemaVersion: 'declaration.v1',
      statements: [
        {
          personKey: 'officer',
          personName: { firstName: 'Amani' },
          assets: [
            { type: 'vehicle', value: { kesCents: 100 } },
            { id: 'x', type: 'unknown' },
          ],
        },
      ],
    });
    expect(view?.statements[0]?.items.assets).toEqual([
      expect.objectContaining({ id: 'x', type: 'Assets', kesCents: 0, detail: '' }),
    ]);
    expect(view?.personal.every((field) => field.value === '')).toBe(true);
    expect(view?.spouses).toEqual([]);
  });
});

describe('personName', () => {
  it('reads first, other and surname', () => {
    expect(personName({ surname: 'Kamau', firstName: 'Wanjiku', otherNames: 'Njeri' })).toBe(
      'Wanjiku Njeri Kamau',
    );
    expect(personName(null)).toBe('');
  });
});
