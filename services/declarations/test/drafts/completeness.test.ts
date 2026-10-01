import type { Statement } from '@adili/forms';
import { describe, expect, it } from 'vitest';

import { assessSections, type DraftSections } from '../../src/drafts/completeness.js';
import {
  assetItem,
  bio,
  household,
  incomeItem,
  liabilityItem,
  other,
  spouse,
  statement,
} from '../fixtures/sections.js';

interface Contents {
  bio: ReturnType<typeof bio>;
  household: ReturnType<typeof household>;
  statement: Statement;
  other: ReturnType<typeof other>;
}

/** A complete draft with one edit applied. */
function draft(edit: (contents: Contents) => void = () => undefined): DraftSections {
  const contents = { bio: bio(), household: household(), statement: statement(), other: other() };
  edit(contents);
  return {
    bio: contents.bio,
    household: contents.household,
    statements: new Map([['officer', contents.statement]]),
    other: contents.other,
  };
}

/** Every issue as `sectionKey path code`, for compact tables. */
function issues(sections: DraftSections): string[] {
  return [...assessSections(sections).values()].flatMap(({ issues: found }) =>
    found.map((issue) => `${issue.sectionKey} ${issue.path} ${issue.code}`),
  );
}

describe('assessSections', () => {
  it('finds a complete draft complete', () => {
    expect([...assessSections(draft())]).toEqual([
      ['bio', { completeness: 'complete', issues: [] }],
      ['household', { completeness: 'complete', issues: [] }],
      ['statement:officer', { completeness: 'complete', issues: [] }],
      ['other', { completeness: 'complete', issues: [] }],
    ]);
  });

  it('passes the schema’s problems through with their codes and paths', () => {
    const sections = draft(({ bio: b }) => {
      delete (b.birth as Partial<typeof b.birth>).place;
    });

    expect(assessSections(sections).get('bio')).toEqual({
      completeness: 'incomplete',
      issues: [
        { sectionKey: 'bio', path: '/birth/place', code: 'required', message: 'is required' },
      ],
    });
  });

  it('always assesses bio and household, and statements and other when given', () => {
    const { bio: b, household: h } = draft();

    expect([...assessSections({ bio: b, household: h }).keys()]).toEqual(['bio', 'household']);
  });
});

describe('nil flags (S8)', () => {
  it.each([
    [
      'nil income with an income item',
      (s: Statement) => {
        s.incomeNil = true;
      },
      ['statement:officer /income nil-conflicts-with-items'],
    ],
    [
      'nil assets with an asset',
      (s: Statement) => {
        s.assetsNil = true;
      },
      ['statement:officer /assets nil-conflicts-with-items'],
    ],
    [
      'nil liabilities with a liability',
      (s: Statement) => {
        s.liabilities = [liabilityItem()];
      },
      ['statement:officer /liabilities nil-conflicts-with-items'],
    ],
    ['nil liabilities and none listed', () => undefined, []],
    [
      'income neither nil nor listed',
      (s: Statement) => {
        s.income = [];
      },
      ['statement:officer /income nil-or-items-required'],
    ],
    [
      'assets neither nil nor listed',
      (s: Statement) => {
        s.assets = [];
      },
      ['statement:officer /assets nil-or-items-required'],
    ],
    [
      'liabilities not yet answered',
      (s: Statement) => {
        s.liabilitiesNil = false;
      },
      ['statement:officer /liabilities nil-or-items-required'],
    ],
  ])('%s', (_name, edit, expected) => {
    expect(
      issues(
        draft(({ statement: s }) => {
          edit(s);
        }),
      ),
    ).toEqual(expected);
  });

  it('says what to do about a conflict', () => {
    const [issue] =
      assessSections(draft(({ statement: s }) => (s.assetsNil = true))).get('statement:officer')
        ?.issues ?? [];

    expect(issue?.message).toBe(
      'You said there are no assets but listed some. Remove them or untick "No assets".',
    );
  });
});

describe('changed-since-last flags (S9)', () => {
  it.each([
    ['no change', { changed: false }, []],
    [
      'a change with neither kind nor explanation',
      { changed: true },
      [
        'statement:officer /income/0/change/kind required',
        'statement:officer /income/0/change/explanation required',
      ],
    ],
    [
      'a change without an explanation',
      { changed: true, kind: 'value-change' },
      ['statement:officer /income/0/change/explanation required'],
    ],
    [
      'a change with a kind and an explanation',
      { changed: true, kind: 'value-change', explanation: 'Promoted in 2026.' },
      [],
    ],
  ] as const)('%s', (_name, change, expected) => {
    const item = { ...incomeItem(), change: { ...change } };

    expect(issues(draft(({ statement: s }) => (s.income = [item])))).toEqual(expected);
  });

  it('applies to assets and liabilities as to income', () => {
    const sections = draft(({ statement: s }) => {
      s.assets = [{ ...assetItem(), change: { changed: true, kind: 'acquisition' } }];
      s.liabilitiesNil = false;
      s.liabilities = [{ ...liabilityItem(), change: { changed: true, kind: 'settled' } }];
    });

    expect(issues(sections)).toEqual([
      'statement:officer /assets/0/change/explanation required',
      'statement:officer /liabilities/0/change/explanation required',
    ]);
  });

  it('says what each missing part is for, on the field', () => {
    const item = { ...incomeItem(), change: { changed: true } };
    const found =
      assessSections(draft(({ statement: s }) => (s.income = [item]))).get('statement:officer')
        ?.issues ?? [];

    expect(found.map(({ path, message }) => [path, message])).toEqual([
      ['/income/0/change/kind', 'Choose what changed since your last declaration.'],
      ['/income/0/change/explanation', 'Explain what changed since your last declaration.'],
    ]);
  });

  it('takes a blank explanation as missing', () => {
    const item = { ...incomeItem(), change: { ...promoted(), explanation: '   ' } };

    expect(issues(draft(({ statement: s }) => (s.income = [item])))).toEqual([
      'statement:officer /income/0/change/explanation required',
    ]);
  });
});

describe('changed-since-last flags on registrable interests (S9)', () => {
  it('needs a kind and an explanation for a directorship or membership flagged as changed', () => {
    const sections = draft(({ other: o }) => {
      o.registrableInterests.directorships = [
        {
          company: 'Lake Basin Holdings Ltd',
          role: 'Director',
          remunerated: true,
          change: { changed: true },
        },
      ];
      o.registrableInterests.memberships = [
        {
          entity: 'Kisumu Golf Club',
          kind: 'club',
          change: { changed: true, kind: 'acquisition', explanation: ' ' },
        },
      ];
    });

    expect(issues(sections)).toEqual([
      'other /registrableInterests/directorships/0/change/kind required',
      'other /registrableInterests/directorships/0/change/explanation required',
      'other /registrableInterests/memberships/0/change/explanation required',
    ]);
  });

  it('takes an explained or unflagged interest as complete', () => {
    const sections = draft(({ other: o }) => {
      o.registrableInterests.directorships = [
        {
          company: 'Lake Basin Holdings Ltd',
          role: 'Director',
          remunerated: true,
          change: { changed: true, kind: 'acquisition', explanation: 'Appointed in 2026.' },
        },
      ];
      o.registrableInterests.memberships = [
        { entity: 'Kisumu Golf Club', kind: 'club', change: { changed: false } },
      ];
    });

    expect(issues(sections)).toEqual([]);
  });
});

function promoted() {
  return { changed: true, kind: 'value-change', explanation: 'Promoted in 2026.' } as const;
}

describe('marital status and spouses (S6)', () => {
  it.each([
    ['married with a spouse', 'married', { none: false, items: [spouse()] }, []],
    [
      'married with no spouse and no "none"',
      'married',
      { none: false, items: [] },
      ['household /spouses spouse-required'],
    ],
    ['married with an explicit "none"', 'married', { none: true, items: [] }, []],
    [
      'separated with no spouse and no "none"',
      'separated',
      { none: false, items: [] },
      ['household /spouses spouse-required'],
    ],
    ['single with no spouse', 'single', { none: false, items: [] }, []],
    [
      'single with a spouse',
      'single',
      { none: false, items: [spouse()] },
      [
        'bio /maritalStatus spouse-conflicts-with-marital-status',
        'household /spouses/items spouse-conflicts-with-marital-status',
      ],
    ],
    [
      'divorced with a spouse',
      'divorced',
      { none: false, items: [spouse()] },
      [
        'bio /maritalStatus spouse-conflicts-with-marital-status',
        'household /spouses/items spouse-conflicts-with-marital-status',
      ],
    ],
    [
      'widowed with a spouse',
      'widowed',
      { none: false, items: [spouse()] },
      [
        'bio /maritalStatus spouse-conflicts-with-marital-status',
        'household /spouses/items spouse-conflicts-with-marital-status',
      ],
    ],
  ] as const)('%s', (_name, maritalStatus, spouses, expected) => {
    const sections = draft(({ bio: b, household: h }) => {
      b.maritalStatus = maritalStatus;
      h.spouses = { none: spouses.none, items: [...spouses.items] };
    });

    expect(issues(sections)).toEqual(expected);
  });

  it('pairs the messages so each capture section names the other', () => {
    const assessed = assessSections(draft(({ bio: b }) => (b.maritalStatus = 'single')));

    expect(assessed.get('bio')?.issues[0]?.message).toBe(
      'You said you are single, but Spouses and children lists a spouse.',
    );
    expect(assessed.get('household')?.issues[0]?.message).toBe(
      'You listed a spouse, but Bio data says you are single.',
    );
  });

  it('checks marital status whatever else is assessed, as bio and household always are', () => {
    const { bio: b, household: h } = draft((contents) => {
      contents.bio.maritalStatus = 'single';
    });

    expect(issues({ bio: b, household: h })).toEqual([
      'bio /maritalStatus spouse-conflicts-with-marital-status',
      'household /spouses/items spouse-conflicts-with-marital-status',
    ]);
  });
});

describe('household', () => {
  it.each([
    [
      '"no spouse" with a spouse listed',
      (h: Contents['household']) => (h.spouses.none = true),
      ['household /spouses/none none-conflicts-with-items'],
    ],
    [
      '"no dependent children" with a child listed',
      (h: Contents['household']) => (h.children.none = true),
      ['household /children/none none-conflicts-with-items'],
    ],
    [
      'children neither "none" nor listed',
      (h: Contents['household']) => (h.children.items = []),
      ['household /children none-or-items-required'],
    ],
    [
      'an explicit "no dependent children"',
      (h: Contents['household']) => (h.children = { none: true, items: [] }),
      [],
    ],
    [
      'a separated spouse without a separation date',
      (h: Contents['household']) => (h.spouses.items = [spouse({ separated: true })]),
      ['household /spouses/items/0/separationDate required'],
    ],
    [
      'a separated spouse with a separation date',
      (h: Contents['household']) =>
        (h.spouses.items = [spouse({ separated: true, separationDate: '2024-05-01' })]),
      [],
    ],
  ])('%s', (_name, edit, expected) => {
    expect(issues(draft(({ household: h }) => edit(h)))).toEqual(expected);
  });
});
