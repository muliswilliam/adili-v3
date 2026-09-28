import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  type DeclarationV1,
  declarationIssues,
  sectionContents,
  validateDeclaration,
} from './index.js';
import {
  biennialHousehold,
  declarationsContract,
  invalidDeclarations,
  pathsOf,
  validDeclarations,
} from './test/fixtures.js';

describe('validateDeclaration', () => {
  it.each(validDeclarations())('accepts %s', (_name, document) => {
    expect(validateDeclaration(document)).toEqual({ ok: true, value: document });
  });

  it.each(invalidDeclarations())(
    'rejects %s with the expected paths (S17)',
    (_name, { errors, document }) => {
      const result = validateDeclaration(document);

      expect(result.ok ? [] : pathsOf(result.errors)).toEqual(errors);
    },
  );
});

describe('declarationIssues', () => {
  it.each(validDeclarations())('finds nothing in %s', (_name, document) => {
    expect(declarationIssues(document)).toEqual({ issues: [], declaration: [] });
  });

  it.each(invalidDeclarations())(
    'places each problem in %s on its capture section and field (S17)',
    (_name, { issues, document }) => {
      expect(declarationIssues(document)).toEqual({ issues, declaration: [] });
    },
  );

  it('places a statement problem on the capture section of the statement’s person', () => {
    const document = biennialHousehold();
    const rent = document.statements[0]?.income[1];
    if (!rent) throw new Error('the fixture’s officer statement has two income items');
    rent.amount.kesCents = -1;

    expect(declarationIssues(document).issues).toEqual([
      {
        sectionKey: 'statement:officer',
        path: '/income/1/amount/kesCents',
        code: 'minimum',
        message: 'must be >= 0',
      },
    ]);
  });

  it('keeps household paths under spouses and children, the household section’s contents', () => {
    const document = biennialHousehold();
    delete (document.spouses as Partial<DeclarationV1['spouses']>).none;

    expect(declarationIssues(document).issues).toEqual([
      { sectionKey: 'household', path: '/spouses/none', code: 'required', message: 'is required' },
    ]);
  });

  it('reports a failed condition once, on the field it requires', () => {
    const document = biennialHousehold();
    const vehicle = document.statements[0]?.assets[2];
    if (!vehicle) throw new Error('the fixture’s officer statement has three assets');
    vehicle.change = { changed: true };

    expect(declarationIssues(document).issues).toEqual([
      {
        sectionKey: 'statement:officer',
        path: '/assets/2/change/kind',
        code: 'required',
        message: 'is required',
      },
      {
        sectionKey: 'statement:officer',
        path: '/assets/2/change/explanation',
        code: 'required',
        message: 'is required',
      },
    ]);
  });

  it('escapes a property name that is not allowed as a JSON pointer segment', () => {
    const document = biennialHousehold();
    Object.assign(document.officer.address, { 'po/box': '40123' });

    expect(declarationIssues(document).issues).toEqual([
      {
        sectionKey: 'bio',
        path: '/address/po~1box',
        code: 'additionalProperties',
        message: 'is not allowed',
      },
    ]);
  });

  it('keeps the service’s own fields out of the capture sections', () => {
    const document = biennialHousehold() as unknown as Record<string, unknown>;
    document.statementDate = '31/12/2025';
    delete document.attestation;

    expect(declarationIssues(document)).toEqual({
      issues: [],
      declaration: [
        { path: 'attestation', message: 'is required' },
        { path: 'statementDate', message: 'must match format "date"' },
      ],
    });
  });

  it('keeps a statement without a usable person key out of the capture sections', () => {
    const document = biennialHousehold();
    (document.statements[3] as Record<string, unknown>).personKey = 'child:unknown';

    expect(declarationIssues(document)).toEqual({
      issues: [],
      declaration: [
        {
          path: 'statements.3.personKey',
          message: 'must match pattern "^(officer|spouse:[0-9a-f-]{36}|child:[0-9a-f-]{36})$"',
        },
      ],
    });
  });
});

describe('the declarations contract', () => {
  const schemas = (parse(declarationsContract()) as { components: { schemas: Contract } })
    .components.schemas;
  interface Contract {
    SectionKey: { pattern: string };
    CompletenessIssue: { required: string[] };
  }

  it('has a SectionKey for every capture section a declaration splits into', () => {
    const sectionKey = new RegExp(schemas.SectionKey.pattern, 'u');
    const keys = validDeclarations().flatMap(([, document]) =>
      sectionContents(document).map(([key]) => key),
    );

    expect(keys).toContain('statement:child:0192f1a0-5a11-7000-8000-000000000203');
    expect(keys.filter((key) => !sectionKey.test(key))).toEqual([]);
  });

  it('has the fields of a DeclarationIssue in a CompletenessIssue', () => {
    const [issue] = declarationIssues(invalidDeclarations()[0]?.[1].document).issues;

    expect(Object.keys(issue ?? {}).sort()).toEqual([...schemas.CompletenessIssue.required].sort());
  });
});
