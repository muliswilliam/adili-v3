import schema from '@adili/schemas/forms/declaration.v1.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

import {
  ASSET_TYPES,
  CHANGE_KINDS,
  COUNTIES,
  COUNTRIES,
  CURRENCIES,
  DeclarationSchema,
  DECLARATION_TYPES,
  declarationIssues,
  EMPLOYMENT_NATURES,
  INCOME_PERIOD_SOURCES,
  INCOME_TYPES,
  ITEM_SOURCE_KINDS,
  LIABILITY_TYPES,
  MARITAL_STATUSES,
  MATERIAL_CHANGE_KINDS,
  MEMBERSHIP_KINDS,
  OCCUPATION_SECTORS,
  sectionContents,
  sectionSchema,
} from './index.js';
import { biennialHousehold, invalidDeclarations, validDeclarations } from './test/fixtures.js';
import { jsonPointer } from './validate.js';

const defs = schema.$defs;
const officer = schema.properties.officer.properties;

/** Zod's issue path as the JSON pointer declarationIssues reports. */
const pointer = (path: PropertyKey[]) => jsonPointer(path.map(String));

/** A fresh biennial and parts of its officer's statement, which edit that declaration. */
function officerStatement() {
  const household = biennialHousehold();
  const statement = household.statements[0];
  const [income] = statement?.income ?? [];
  const [land] = statement?.assets ?? [];
  if (!statement || !income || !land) throw new Error('the officer’s statement has changed');
  return { household, statement, income, land };
}

describe('declaration.v1 enumerations', () => {
  it.each([
    ['DECLARATION_TYPES', DECLARATION_TYPES, schema.properties.type.enum],
    [
      'INCOME_PERIOD_SOURCES',
      INCOME_PERIOD_SOURCES,
      schema.properties.incomePeriod.properties.fromSource.enum,
    ],
    ['MARITAL_STATUSES', MARITAL_STATUSES, officer.maritalStatus.enum],
    ['EMPLOYMENT_NATURES', EMPLOYMENT_NATURES, officer.employment.properties.nature.enum],
    ['OCCUPATION_SECTORS', OCCUPATION_SECTORS, defs.Spouse.properties.occupationSector.enum],
    ['INCOME_TYPES', INCOME_TYPES, defs.IncomeItem.properties.type.enum],
    ['ASSET_TYPES', ASSET_TYPES, defs.AssetItem.properties.type.enum],
    ['LIABILITY_TYPES', LIABILITY_TYPES, defs.LiabilityItem.properties.type.enum],
    ['CHANGE_KINDS', CHANGE_KINDS, defs.ChangeFlag.properties.kind.enum],
    ['MATERIAL_CHANGE_KINDS', MATERIAL_CHANGE_KINDS, defs.MaterialChangeEntry.properties.kind.enum],
    ['ITEM_SOURCE_KINDS', ITEM_SOURCE_KINDS, defs.ItemSource.properties.kind.enum],
    [
      'MEMBERSHIP_KINDS',
      MEMBERSHIP_KINDS,
      defs.RegistrableInterests.properties.memberships.items.properties.kind.enum,
    ],
  ])('%s lists the schema’s values in schema order', (_name, values, expected) => {
    expect(values).toEqual(expected);
  });

  it('lists the 47 counties by code, each one the schema accepts', () => {
    const pattern = new RegExp(defs.Location.properties.county.pattern, 'u');

    expect(COUNTIES.map((county) => county.code)).toEqual(
      Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(3, '0')),
    );
    expect(COUNTIES.filter((county) => !pattern.test(county.code))).toEqual([]);
    expect(COUNTIES.at(-1)).toEqual({ code: '047', name: 'Nairobi City' });
  });

  it('lists the ISO 3166-1 countries once each, each one the schema accepts', () => {
    const pattern = new RegExp(defs.Location.properties.country.pattern, 'u');
    const codes = COUNTRIES.map((country) => country.code);

    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((code) => !pattern.test(code))).toEqual([]);
    expect(COUNTRIES).toContainEqual({ code: 'KE', name: 'Kenya' });
    expect(COUNTRIES.filter((country) => !country.name)).toEqual([]);
  });

  it('lists the current ISO 4217 currencies once each, each one the schema accepts', () => {
    const pattern = new RegExp(defs.Money.properties.original.properties.currency.pattern, 'u');
    const codes = CURRENCIES.map((currency) => currency.code);

    expect(CURRENCIES.length).toBeGreaterThan(150);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((code) => !pattern.test(code))).toEqual([]);
    expect(CURRENCIES).toContainEqual({ code: 'USD', name: 'US Dollar' });
    expect(codes).toContain('KES');
    expect(CURRENCIES.filter((currency) => !currency.name)).toEqual([]);
  });
});

describe('Zod schemas', () => {
  it.each(validDeclarations())('accept the whole of %s', (_name, document) => {
    expect(DeclarationSchema.safeParse(document).error?.issues).toBeUndefined();
  });

  it.each(validDeclarations())('accept every capture section of %s', (_name, document) => {
    for (const [key, contents] of sectionContents(document)) {
      expect(sectionSchema(key).safeParse(contents).error?.issues, key).toBeUndefined();
    }
  });

  it.each(invalidDeclarations())(
    'reject the capture sections of %s at the fields the JSON Schema does',
    (_name, { issues, document }) => {
      const contents = new Map(sectionContents(document));

      for (const key of new Set(issues.map((issue) => issue.sectionKey))) {
        const result = sectionSchema(key).safeParse(contents.get(key));

        expect(
          result.error?.issues.map((issue) => pointer(issue.path)),
          key,
        ).toEqual(issues.filter((issue) => issue.sectionKey === key).map((issue) => issue.path));
      }
    },
  );

  it('require the kind and explanation of a flagged change', () => {
    const { statement, income } = officerStatement();
    income.change = { changed: true };

    const result = sectionSchema('statement:officer').safeParse(statement);

    expect(result.error?.issues.map((issue) => [pointer(issue.path), issue.message])).toEqual([
      ['/income/0/change/kind', 'is required'],
      ['/income/0/change/explanation', 'is required'],
    ]);
  });

  it('require a share for a joint asset', () => {
    const { statement, land } = officerStatement();
    land.joint = { isJoint: true };

    const result = sectionSchema('statement:officer').safeParse(statement);

    expect(result.error?.issues.map((issue) => pointer(issue.path))).toEqual([
      '/assets/0/joint/sharePercent',
    ]);
  });

  // Documented on sectionSchema: completeness comes from declarationIssues, not from Zod.
  it('check a flagged change’s kind only once its explanation parses, unlike the JSON Schema', () => {
    const { household, statement, income } = officerStatement();
    income.change = { changed: true, explanation: 5 as unknown as string };

    const zod = sectionSchema('statement:officer').safeParse(statement);
    const ajv = declarationIssues(household).issues;

    expect(zod.error?.issues.map((issue) => pointer(issue.path))).toEqual([
      '/income/0/change/explanation',
    ]);
    expect(ajv.map((issue) => issue.path)).toEqual([
      '/income/0/change/kind',
      '/income/0/change/explanation',
    ]);
  });
});

describe('sectionContents', () => {
  it('splits a declaration into its capture sections, one statement per person', () => {
    const household = biennialHousehold();

    expect(sectionContents(household).map(([key]) => key)).toEqual([
      'bio',
      'household',
      'statement:officer',
      'statement:spouse:0192f1a0-5a11-7000-8000-000000000101',
      'statement:spouse:0192f1a0-5a11-7000-8000-000000000102',
      'statement:child:0192f1a0-5a11-7000-8000-000000000202',
      'statement:child:0192f1a0-5a11-7000-8000-000000000203',
      'other',
    ]);
    expect(new Map(sectionContents(household)).get('household')).toEqual({
      spouses: household.spouses,
      children: household.children,
    });
  });
});
