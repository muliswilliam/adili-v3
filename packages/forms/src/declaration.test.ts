import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  type DeclarationIssue,
  type DeclarationV1,
  declarationIssues,
  validateDeclaration,
} from './index.js';

const require = createRequire(import.meta.url);
const fixturesDir = join(
  dirname(require.resolve('@adili/schemas/package.json')),
  'forms/fixtures/declaration.v1',
);

function fixtures(kind: 'valid' | 'invalid') {
  const dir = join(fixturesDir, kind);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown] as const);
}

interface InvalidFixture {
  errors: string[];
  issues: DeclarationIssue[];
  document: Record<string, unknown>;
}

const biennial = fixtures('valid').find(
  ([name]) => name === 'biennial-household.json',
)?.[1] as DeclarationV1;

describe('validateDeclaration', () => {
  it.each(fixtures('valid'))('accepts %s', (_name, document) => {
    expect(validateDeclaration(document)).toEqual({ ok: true, value: document });
  });

  it.each(fixtures('invalid'))('rejects %s with the expected paths (S17)', (_name, fixture) => {
    const { errors, document } = fixture as InvalidFixture;

    const result = validateDeclaration(document);

    expect(result.ok ? [] : result.errors.map((error) => error.path)).toEqual(errors);
  });
});

describe('declarationIssues', () => {
  it.each(fixtures('valid'))('finds nothing in %s', (_name, document) => {
    expect(declarationIssues(document)).toEqual([]);
  });

  it.each(fixtures('invalid'))(
    'places each problem in %s on its section and field (S17)',
    (_name, fixture) => {
      const { issues, document } = fixture as InvalidFixture;

      expect(declarationIssues(document)).toEqual(issues);
    },
  );

  it('places a statement problem on the section of the statement’s person', () => {
    const document = structuredClone(biennial);
    const rent = document.statements[0]?.income[1];
    if (!rent) throw new Error('the fixture’s officer statement has two income items');
    rent.amount.kesCents = -1;

    expect(declarationIssues(document)).toEqual([
      {
        sectionKey: 'statement:officer',
        path: 'income.1.amount.kesCents',
        message: 'must be >= 0',
      },
    ]);
  });

  it('keeps household paths under spouses and children, the household section’s contents', () => {
    const document = structuredClone(biennial);
    delete (document.spouses as Partial<DeclarationV1['spouses']>).none;

    expect(declarationIssues(document)).toEqual([
      { sectionKey: 'household', path: 'spouses.none', message: 'is required' },
    ]);
  });

  it('leaves declaration-level problems outside any section', () => {
    const document = structuredClone(biennial) as unknown as Record<string, unknown>;
    document.statementDate = '31/12/2025';
    delete document.attestation;

    expect(declarationIssues(document)).toEqual([
      { sectionKey: null, path: 'attestation', message: 'is required' },
      { sectionKey: null, path: 'statementDate', message: 'must match format "date"' },
    ]);
  });

  it('leaves a statement without a usable person key outside any section', () => {
    const document = structuredClone(biennial);
    (document.statements[3] as Record<string, unknown>).personKey = 'child:unknown';

    expect(declarationIssues(document)).toEqual([
      {
        sectionKey: null,
        path: 'statements.3.personKey',
        message: 'must match pattern "^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$"',
      },
    ]);
  });
});
