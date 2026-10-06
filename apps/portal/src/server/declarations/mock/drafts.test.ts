import { beforeEach, describe, expect, it } from 'vitest';

import type { DeclarationVersion } from '../types';
import { resetDeclarationsMock } from '../mock.server';
import { startDeclaration } from './drafts';
import { COMMISSIONS, MOCK_OBLIGATIONS, OBLIGATIONS } from './fixtures';
import { type Filed, type Header, store, type Stored } from './store';
import { newSuggestionState } from './suggestions';

/** The TSC biennial 2027 obligation, statement date 1 Nov 2027. */
const biennial = OBLIGATIONS.find((each) => each.id === MOCK_OBLIGATIONS.biennial) ?? fail();

function fail(): never {
  throw new Error('The biennial fixture is missing');
}

/** A declaration the demo declarant (no token) filed, listing one spouse under `spouseId`. */
function filed(
  id: string,
  commission: keyof typeof COMMISSIONS,
  statementDate: string,
  spouseId: string,
): Stored {
  const header: Header = {
    id,
    obligationId: `obligation-${id}`,
    commission: COMMISSIONS[commission],
    type: 'biennial',
    statementDate,
    dueDate: statementDate,
    incomePeriod: { from: statementDate, to: statementDate, fromSource: 'assumed' },
    schemaVersion: 'declaration.v1',
    reference: null,
    currentVersion: 1,
    amendingFromVersion: null,
    createdAt: '2024-01-01T00:00:00Z',
  };
  const empty: Filed['sections'] = {
    contents: new Map(),
    savedAt: new Map(),
    persons: [],
    archived: new Set(),
    attachments: new Map(),
  };
  return {
    owner: null,
    header,
    status: 'submitted',
    draftVersion: 1,
    updatedAt: '2024-01-01T00:00:00Z',
    lastSection: null,
    ...empty,
    suggestions: newSuggestionState(),
    filing: { statementDate, dueDate: statementDate, cancelled: false },
    versions: [{ version: 1 } as DeclarationVersion],
    filed: new Map([
      [
        1,
        {
          document: {
            spouses: { none: false, items: [{ id: spouseId, name: { surname: 'Kennedy' } }] },
            children: { none: true, items: [] },
          },
          sections: empty,
        },
      ],
    ]),
  };
}

function seed(...declarations: Stored[]) {
  for (const each of declarations) store.set(each.header.id, each);
}

/** The household the new TSC draft started with, and where it was carried from. */
async function started() {
  const response = startDeclaration(null, biennial.id, biennial);
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const stored = store.get(id);
  return { household: stored?.contents.get('household'), from: stored?.carriedOverFrom };
}

function spouseIds(household: Record<string, unknown> | undefined) {
  const spouses = household?.spouses as { items: { id: string }[] } | undefined;
  return spouses?.items.map((spouse) => spouse.id);
}

beforeEach(() => {
  resetDeclarationsMock();
});

describe('household carried into a new draft (story 4)', () => {
  it('carries from the last declaration to the same Commission before the statement date', async () => {
    seed(
      filed(
        'a0000000-0000-4000-8000-000000000001',
        'tsc',
        '2023-11-01',
        'aaaaaaaa-0000-4000-8000-000000000001',
      ),
      filed(
        'a0000000-0000-4000-8000-000000000002',
        'tsc',
        '2025-11-01',
        'aaaaaaaa-0000-4000-8000-000000000002',
      ),
      filed(
        'a0000000-0000-4000-8000-000000000003',
        'psc',
        '2026-09-10',
        'aaaaaaaa-0000-4000-8000-000000000003',
      ),
      filed(
        'a0000000-0000-4000-8000-000000000004',
        'tsc',
        '2029-11-01',
        'aaaaaaaa-0000-4000-8000-000000000004',
      ),
    );
    const { household, from } = await started();
    expect(spouseIds(household)).toEqual(['aaaaaaaa-0000-4000-8000-000000000002']);
    expect(from).toEqual({ statementDate: '2025-11-01' });
  });

  it('carries nothing when only another Commission or a later statement date was declared', async () => {
    seed(
      filed(
        'a0000000-0000-4000-8000-000000000003',
        'psc',
        '2026-09-10',
        'aaaaaaaa-0000-4000-8000-000000000003',
      ),
      filed(
        'a0000000-0000-4000-8000-000000000004',
        'tsc',
        '2027-11-01',
        'aaaaaaaa-0000-4000-8000-000000000004',
      ),
    );
    const { household, from } = await started();
    expect(household).toEqual({});
    expect(from).toBeUndefined();
  });

  it('breaks a tie on statement date by the highest declaration id', async () => {
    seed(
      filed(
        'b0000000-0000-4000-8000-000000000002',
        'tsc',
        '2025-11-01',
        'bbbbbbbb-0000-4000-8000-000000000002',
      ),
      filed(
        'b0000000-0000-4000-8000-000000000001',
        'tsc',
        '2025-11-01',
        'bbbbbbbb-0000-4000-8000-000000000001',
      ),
    );
    const { household } = await started();
    expect(spouseIds(household)).toEqual(['bbbbbbbb-0000-4000-8000-000000000002']);
  });

  it("carries each person's id in lower case", async () => {
    seed(
      filed(
        'a0000000-0000-4000-8000-000000000002',
        'tsc',
        '2025-11-01',
        'AAAAAAAA-0000-4000-8000-00000000000A',
      ),
    );
    const { household } = await started();
    expect(spouseIds(household)).toEqual(['aaaaaaaa-0000-4000-8000-00000000000a']);
  });
});
