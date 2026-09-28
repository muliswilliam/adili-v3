import schema from '@adili/schemas/forms/declaration.v1.json' with { type: 'json' };
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ASSET_TYPES,
  CHANGE_KINDS,
  COUNTIES,
  CURRENCIES,
  type DeclarationIssue,
  DeclarationSchema,
  type DeclarationV1,
  DECLARATION_TYPES,
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

const require = createRequire(import.meta.url);
const fixturesDir = join(
  dirname(require.resolve('@adili/schemas/package.json')),
  'forms/fixtures/declaration.v1',
);

function fixtures<T>(kind: 'valid' | 'invalid') {
  const dir = join(fixturesDir, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as T] as const);
}

interface InvalidFixture {
  issues: DeclarationIssue[];
  document: DeclarationV1;
}

function officerStatement() {
  const household = fixtures<DeclarationV1>('valid').find(
    ([name]) => name === 'biennial-household.json',
  )?.[1];
  const statement = structuredClone(household?.statements[0]);
  const [income] = statement?.income ?? [];
  const [land] = statement?.assets ?? [];
  if (!household || !statement || !income || !land) throw new Error('fixture has changed');
  return { household, statement, income, land };
}

const defs = schema.$defs;
const officer = schema.properties.officer.properties;

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
    const pattern = new RegExp(defs.Location.properties.county.pattern);

    expect(COUNTIES).toHaveLength(47);
    expect(COUNTIES.map((county) => county.code)).toEqual(
      Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(3, '0')),
    );
    expect(COUNTIES.filter((county) => !pattern.test(county.code))).toEqual([]);
    expect(COUNTIES.at(-1)).toEqual({ code: '047', name: 'Nairobi City' });
  });

  it('offers currencies the schema accepts, without the shilling', () => {
    const pattern = new RegExp(defs.Money.properties.original.properties.currency.pattern);

    expect(CURRENCIES.filter((code) => !pattern.test(code))).toEqual([]);
    expect(CURRENCIES).not.toContain('KES');
    expect(new Set(CURRENCIES).size).toBe(CURRENCIES.length);
  });
});

describe('Zod schemas', () => {
  it.each(fixtures<DeclarationV1>('valid'))('accept the whole of %s', (_name, document) => {
    expect(DeclarationSchema.safeParse(document).error?.issues).toBeUndefined();
  });

  it.each(fixtures<DeclarationV1>('valid'))('accept every section of %s', (_name, document) => {
    for (const [key, contents] of sectionContents(document)) {
      expect(sectionSchema(key).safeParse(contents).error?.issues, key).toBeUndefined();
    }
  });

  // Ajv also reports a failed if/then on the object itself; Zod reports the field only.
  const fieldIssues = (issues: DeclarationIssue[]) =>
    issues.filter((issue) => !/^must match "(then|else)" schema$/.test(issue.message));

  it.each(fixtures<InvalidFixture>('invalid'))(
    'reject the section of %s at the same fields as the JSON Schema',
    (_name, { issues, document }) => {
      const [first] = issues;
      if (!first?.sectionKey) throw new Error('every paragraph fixture fails in a section');
      const contents = new Map(sectionContents(document)).get(first.sectionKey);

      const result = sectionSchema(first.sectionKey).safeParse(contents);

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
        fieldIssues(issues).map((issue) => issue.path),
      );
    },
  );

  it('require the kind and explanation of a flagged change', () => {
    const { statement, income } = officerStatement();
    income.change = { changed: true };

    const result = sectionSchema('statement:officer').safeParse(statement);

    expect(result.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['income.0.change.kind', 'is required'],
      ['income.0.change.explanation', 'is required'],
    ]);
  });

  it('require a share for a joint asset', () => {
    const { statement, land } = officerStatement();
    land.joint = { isJoint: true };

    const result = sectionSchema('statement:officer').safeParse(statement);

    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'assets.0.joint.sharePercent',
    ]);
  });
});

describe('sectionContents', () => {
  it('splits a declaration into its capture sections, one statement per person', () => {
    const { household } = officerStatement();

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
