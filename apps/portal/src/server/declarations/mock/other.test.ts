import createClient from 'openapi-fetch';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadSection, loadSummary, saveSection, startDeclaration } from '../../declarations.server';
import { MOCK_OBLIGATIONS, mockDeclarationsFetch, resetDeclarationsMock } from '../mock.server';
import type { Draft, OtherInformation } from '../../../declaration/contents';
import type { paths } from '../schema.gen';
import type { RuleContext } from './context';
import { composeMaterialChanges, otherCompleteness } from './other';

const client = () =>
  createClient<paths>({ baseUrl: 'http://declarations.test', fetch: mockDeclarationsFetch });

function context(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    key: 'other',
    type: 'biennial',
    statementDate: '2027-11-01',
    officer: {},
    household: {},
    statements: new Map(),
    ...overrides,
  };
}

const ANSWERED = { dualCitizenship: { holds: false, pendingApplication: false } };
const ANSWERED_INTERESTS = { registrableInterests: ANSWERED };

// The mock's obligations are fixed dates (the biennial's statement date is 2027-11-01), so the
// round trip runs on a clock pinned before them, as the other declarations tests do.
const NOW = Date.parse('2026-09-30T07:42:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetDeclarationsMock();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('other information rules (S11)', () => {
  it('asks for dual citizenship on a fresh section', () => {
    expect(otherCompleteness({}, context()).map((issue) => issue.message)).toEqual([
      'Say whether you hold another citizenship.',
      'Say whether you have a pending citizenship application.',
    ]);
  });

  it('asks for the country when another citizenship is held', () => {
    const issues = otherCompleteness(
      { registrableInterests: { dualCitizenship: { holds: true, pendingApplication: false } } },
      context(),
    );
    expect(issues).toEqual([
      {
        sectionKey: 'other',
        path: '/registrableInterests/dualCitizenship/country',
        code: 'required',
        message: 'Choose the other country of citizenship.',
      },
    ]);
  });

  it('names each incomplete interest card by number', () => {
    const issues = otherCompleteness(
      {
        registrableInterests: {
          ...ANSWERED,
          directorships: [{ company: 'A', role: 'Director', remunerated: true }, { company: 'B' }],
          memberships: [{ entity: 'Club' }],
          pendingCases: [{ forum: 'Court' }],
        },
      },
      context(),
    );
    expect(issues.map((issue) => [issue.path, issue.message])).toEqual([
      [
        '/registrableInterests/directorships/1',
        'Directorship 2: enter the company, your role and whether it is paid.',
      ],
      ['/registrableInterests/memberships/0', 'Membership 1: enter the name and the kind of body.'],
      [
        '/registrableInterests/pendingCases/0',
        'Pending case 1: enter the court or body, case reference and nature.',
      ],
    ]);
  });

  it('keeps free text within 4,000 characters', () => {
    expect(
      otherCompleteness(
        { registrableInterests: ANSWERED, freeText: 'x'.repeat(4001) },
        context(),
      ).map((issue) => issue.code),
    ).toEqual(['too-long']);
    expect(
      otherCompleteness({ registrableInterests: ANSWERED, freeText: 'x'.repeat(4000) }, context()),
    ).toEqual([]);
  });

  it('composes material changes from the marital change and flagged items', () => {
    const entries = composeMaterialChanges(
      context({
        officer: { maritalStatusChange: { changed: true, explanation: 'Married.' } },
        statements: new Map([
          [
            'statement:officer',
            {
              personKey: 'officer',
              assets: [
                {
                  id: 'a1',
                  description: 'Plot',
                  change: { changed: true, kind: 'acquisition', explanation: 'Bought.' },
                },
                { id: 'a2', description: 'Car', change: { changed: false } },
              ],
            },
          ],
        ]),
      }),
      {},
    );
    expect(entries).toEqual([
      { personKey: 'officer', kind: 'marital-status', explanation: 'Married.' },
      {
        personKey: 'officer',
        itemId: 'a1',
        itemDescription: 'Plot',
        kind: 'acquisition',
        explanation: 'Bought.',
      },
    ]);
  });
  it('leaves out a marital change or flagged item explained only in spaces', () => {
    const entries = composeMaterialChanges(
      context({
        officer: { maritalStatusChange: { changed: true, explanation: '   ' } },
        statements: new Map([
          [
            'statement:officer',
            {
              personKey: 'officer',
              assets: [
                {
                  id: 'a1',
                  description: 'Plot',
                  change: { changed: true, kind: 'acquisition', explanation: ' ' },
                },
              ],
            },
          ],
        ]),
      }),
      {},
    );
    expect(entries).toEqual([]);
  });
});

describe('changes to directorships and memberships (S9)', () => {
  const flagged: Draft<OtherInformation> = {
    registrableInterests: {
      directorships: [
        {
          company: 'Kapsoya Water Ltd',
          role: 'Director',
          remunerated: true,
          change: { changed: true, kind: 'acquisition', explanation: 'Appointed in May 2026.' },
        },
        { company: 'Eldoret Mills', role: 'Chair', remunerated: false, change: { changed: false } },
      ],
      memberships: [
        {
          entity: 'Kapsoya Parents Welfare Group',
          kind: 'society',
          change: { changed: true, kind: 'disposal', explanation: 'Left in June 2026.' },
        },
      ],
    },
  };

  it('composes a flagged directorship or membership after the flagged items', () => {
    expect(composeMaterialChanges(context(), flagged)).toEqual([
      {
        personKey: 'officer',
        itemDescription: 'Kapsoya Water Ltd',
        kind: 'directorship',
        explanation: 'Appointed in May 2026.',
      },
      {
        personKey: 'officer',
        itemDescription: 'Kapsoya Parents Welfare Group',
        kind: 'membership',
        explanation: 'Left in June 2026.',
      },
    ]);
  });

  it('leaves out a flag still missing its kind or explanation, and asks for them', () => {
    const other: Draft<OtherInformation> = {
      ...ANSWERED_INTERESTS,
      registrableInterests: {
        ...ANSWERED_INTERESTS.registrableInterests,
        directorships: [
          {
            company: 'Kapsoya Water Ltd',
            role: 'Director',
            remunerated: true,
            change: { changed: true },
          },
        ],
        memberships: [
          {
            entity: 'Kapsoya Parents Welfare Group',
            kind: 'society',
            change: { changed: true, kind: 'disposal', explanation: ' ' },
          },
        ],
      },
    };

    expect(composeMaterialChanges(context(), other)).toEqual([]);
    expect(otherCompleteness(other, context()).map(({ path, message }) => [path, message])).toEqual(
      [
        [
          '/registrableInterests/directorships/0/change/kind',
          'Choose what changed since your last declaration.',
        ],
        [
          '/registrableInterests/directorships/0/change/explanation',
          'Explain what changed since your last declaration.',
        ],
        [
          '/registrableInterests/memberships/0/change/explanation',
          'Explain what changed since your last declaration.',
        ],
      ],
    );
  });

  it('has no changes on an initial declaration, which follows none', () => {
    const initial = context({ type: 'initial' });
    expect(composeMaterialChanges(initial, flagged)).toEqual([]);
    expect(
      otherCompleteness(
        {
          registrableInterests: {
            ...ANSWERED,
            directorships: [
              { company: 'K', role: 'D', remunerated: true, change: { changed: true } },
            ],
          },
        },
        initial,
      ),
    ).toEqual([]);
  });
});

describe('other information round trip (S11, S12)', () => {
  it('saves interests without the composed changes and renders them in the summary', async () => {
    const started = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
    if (started.status !== 'started') throw new Error(started.status);
    const id = started.declaration.id;
    const interests = {
      directorships: [{ company: 'Kapsoya Water Ltd', role: 'Director', remunerated: false }],
      memberships: [{ entity: 'Parents Welfare Group', kind: 'society' as const }],
      dualCitizenship: { holds: false, pendingApplication: true },
      pendingCases: [{ forum: 'Eldoret CMC', reference: 'ELC 45 of 2025', nature: 'Boundary' }],
    };

    const outcome = await saveSection(client(), {
      declarationId: id,
      sectionKey: 'other',
      ifMatch: '"1"',
      contents: {
        materialChanges: [{ kind: 'settled' }],
        registrableInterests: interests,
        freeText: 'More.',
      },
    });
    expect(outcome).toMatchObject({ status: 'saved', result: { completeness: 'complete' } });

    const loaded = await loadSection(client(), id, 'other');
    expect(loaded).toMatchObject({ status: 'ok', section: { contents: { materialChanges: [] } } });

    const summary = await loadSummary(client(), id);
    if (summary.status !== 'ok') throw new Error(summary.status);
    expect(summary.summary.document.otherInformation).toEqual({
      materialChanges: [],
      registrableInterests: interests,
      freeText: 'More.',
    });
    expect(summary.summary.cannotSubmitReason).toBe('before-statement-date');
    expect(summary.summary.blocking.some((issue) => issue.sectionKey === 'other')).toBe(false);
  });
});
