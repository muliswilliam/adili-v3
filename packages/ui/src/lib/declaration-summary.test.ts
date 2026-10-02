import { validateDeclaration } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import {
  BUILDING_ID,
  SPOUSE_KEY,
  VEHICLE_ID,
  WANJIKU_DECLARATION,
} from '../components/fixtures/declaration';
import {
  anchorIdFor,
  assetDetailsLine,
  childLine,
  declarationAttachments,
  findItem,
  householdTotals,
  itemDescriptionLine,
  locationText,
  ownershipText,
  personFullName,
  personKind,
  sectionAnchorId,
  spouseLine,
  statementTotals,
} from './declaration-summary';

function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing from the fixture');
  return value;
}

const officer = must(WANJIKU_DECLARATION.statements[0]);
const spouse = must(WANJIKU_DECLARATION.statements[1]);

describe('declaration summary', () => {
  it('works on a valid declaration.v1 fixture', () => {
    expect(validateDeclaration(WANJIKU_DECLARATION)).toMatchObject({ ok: true });
  });

  it('names a person first name, other names, surname', () => {
    expect(personFullName(WANJIKU_DECLARATION.officer.name)).toBe('Wanjiku Njeri Kamau');
    expect(personFullName({ surname: 'Kamau', firstName: 'David', otherNames: ' ' })).toBe(
      'David Kamau',
    );
  });

  it('tells the person from the key', () => {
    expect(personKind('officer')).toBe('officer');
    expect(personKind(SPOUSE_KEY)).toBe('spouse');
    expect(personKind('child:x')).toBe('child');
  });

  it('adds up each statement and the household, joint assets at whole value', () => {
    expect(statementTotals(officer)).toEqual({
      income: 540_000_000,
      assets: 2_491_000_000,
      liabilities: 678_000_000,
    });
    expect(householdTotals(WANJIKU_DECLARATION.statements)).toEqual({
      income: 730_000_000,
      assets: 2_925_500_000,
      liabilities: 768_000_000,
    });
  });

  it('writes places in and outside Kenya', () => {
    expect(locationText({ inKenya: true, county: '016', detail: 'Syokimau' })).toBe(
      'Syokimau, Machakos',
    );
    expect(locationText({ inKenya: false, country: 'UG', detail: 'Kampala' })).toBe(
      'Kampala, Uganda',
    );
    expect(locationText({ inKenya: true })).toBe('');
  });

  it('says who owns an asset', () => {
    expect(ownershipText({ isJoint: false })).toBe('Sole');
    expect(ownershipText({ isJoint: true })).toBe('Joint');
    expect(ownershipText({ isJoint: true, sharePercent: 50, coOwner: 'David Kamau' })).toBe(
      'Joint, 50% share with David Kamau',
    );
  });

  it('describes an item with its place, ownership, creditor and original currency', () => {
    const account = must(officer.assets[3]);
    expect(itemDescriptionLine('assets', account)).toBe(
      'Stanbic Bank Uganda account · Kampala, Uganda · Joint, 50% share with David Kamau · Originally UGX 11,800,000',
    );
    expect(itemDescriptionLine('liabilities', must(spouse.liabilities[0]))).toBe(
      'Stock financing · Equity Bank Kenya · Kajiado',
    );
    // Identifiers the description already gives are left out.
    expect(assetDetailsLine(must(officer.assets[1]))).toBe('Parcel NYERI/MUKURWE-INI/1187');
    expect(assetDetailsLine(must(officer.assets[2]))).toBe(
      'Make and model Toyota Land Cruiser Prado',
    );
    expect(assetDetailsLine(must(officer.assets[3]))).toBe('Savings account');
  });

  it('describes spouses and children without their numbers', () => {
    expect(spouseLine(must(WANJIKU_DECLARATION.spouses.items[0]))).toEqual([
      'National ID declared',
      'Private sector',
    ]);
    expect(
      childLine({
        id: 'c',
        name: { surname: 'K', firstName: 'A' },
        dateOfBirth: '2007-01-02',
        nationalId: '1',
        includedAtStatementDate: false,
      }),
    ).toEqual(['Born 2 Jan 2007', 'National ID declared', '18 or over on the statement date']);
  });

  it('anchors an item, else its section, else the person’s statement', () => {
    expect(anchorIdFor({ itemId: BUILDING_ID, sectionKey: 'statement:officer' })).toBe(
      'declaration-item-' + BUILDING_ID,
    );
    expect(anchorIdFor({ sectionKey: 'bio' }, 'case')).toBe('case-section-bio');
    expect(anchorIdFor({ personKey: SPOUSE_KEY })).toBe(sectionAnchorId('statement:' + SPOUSE_KEY));
    expect(sectionAnchorId('statement:' + SPOUSE_KEY)).toMatch(/^declaration-section-[\w-]+$/);
    expect(anchorIdFor({})).toBeNull();
  });

  it('finds items and lists the attachments with the item they support', () => {
    expect(findItem(WANJIKU_DECLARATION, VEHICLE_ID)).toMatchObject({
      category: 'assets',
      statement: { personKey: 'officer' },
    });
    expect(findItem(WANJIKU_DECLARATION, 'missing')).toBeNull();
    expect(
      declarationAttachments(WANJIKU_DECLARATION).map((each) => [
        each.attachment.fileName,
        each.item.id,
      ]),
    ).toEqual([
      ['Title deed LR 12715-482.pdf', BUILDING_ID],
      ['Valuation report Syokimau 2025.pdf', BUILDING_ID],
    ]);
  });
});
