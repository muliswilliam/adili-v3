import createClient from 'openapi-fetch';
import { beforeEach, describe, expect, it } from 'vitest';

import type { MaritalStatus } from '../../../components/declaration/contents';
import { HOUSEHOLD_MESSAGES } from '../../../components/declaration/household';
import {
  loadDeclaration,
  saveSection,
  type SaveOutcome,
  startDeclaration,
} from '../../declarations.server';
import { MOCK_OBLIGATIONS, mockDeclarationsFetch, resetDeclarationsMock } from '../mock.server';
import type { paths } from '../schema.gen';

const client = () =>
  createClient<paths>({ baseUrl: 'http://declarations.test', fetch: mockDeclarationsFetch });

function saved(outcome: SaveOutcome) {
  if (outcome.status !== 'saved') throw new Error(outcome.status);
  return outcome;
}

async function withStatus(maritalStatus: MaritalStatus) {
  const started = await startDeclaration(client(), MOCK_OBLIGATIONS.biennial);
  if (started.status !== 'started') throw new Error(started.status);
  const loaded = await loadDeclaration(client(), started.declaration.id);
  if (loaded.status !== 'ok') throw new Error(loaded.status);
  const bio = saved(
    await saveSection(client(), {
      declarationId: loaded.declaration.id,
      sectionKey: 'bio',
      ifMatch: loaded.etag,
      contents: {
        name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
        employment: {
          designation: 'Deputy Principal',
          employer: 'Nyeri High School',
          responsibleCommission: 'tsc',
          personnelFileNumber: 'TSC/999999',
        },
        maritalStatus,
      },
    }),
  );
  return { id: loaded.declaration.id, etag: bio.etag };
}

async function saveHousehold(maritalStatus: MaritalStatus, contents: Record<string, unknown>) {
  const { id, etag } = await withStatus(maritalStatus);
  return saved(
    await saveSection(client(), {
      declarationId: id,
      sectionKey: 'household',
      ifMatch: etag,
      contents,
    }),
  ).result;
}

const spouse = {
  id: '11111111-1111-4111-8111-111111111111',
  name: { surname: 'Kennedy', firstName: 'Mary' },
  separated: false,
};

beforeEach(() => {
  resetDeclarationsMock();
});

describe('household completeness in the mock (S6)', () => {
  it('blocks a spouse when the declarant said they are single', async () => {
    const result = await saveHousehold('single', {
      spouses: { none: false, items: [spouse] },
      children: { none: true, items: [] },
    });
    expect(result.completeness).toBe('incomplete');
    expect(result.issues).toEqual([
      {
        sectionKey: 'household',
        path: '/spouses',
        code: 'spouse-conflicts-with-marital-status',
        message: HOUSEHOLD_MESSAGES.spouseConflict('single'),
      },
    ]);
  });

  it('is incomplete when married with no spouse and no explicit none', async () => {
    const result = await saveHousehold('married', {
      spouses: { none: false, items: [] },
      children: { none: true, items: [] },
    });
    expect(result.completeness).toBe('incomplete');
    expect(result.issues.map((found) => found.message)).toEqual([
      HOUSEHOLD_MESSAGES.spouseUnanswered,
    ]);
  });

  it('is complete once the declarant confirms no spouse and no children', async () => {
    const result = await saveHousehold('married', {
      spouses: { none: true, items: [] },
      children: { none: true, items: [] },
    });
    expect(result).toMatchObject({ completeness: 'complete', issues: [], sectionsChanged: [] });
  });

  it('refuses a malformed KRA PIN with a field message', async () => {
    const result = await saveHousehold('married', {
      spouses: { none: false, items: [{ ...spouse, kraPin: 'X1' }] },
      children: { none: true, items: [] },
    });
    expect(result.issues).toEqual([
      {
        sectionKey: 'household',
        path: '/spouses/items/0/kraPin',
        code: 'pattern',
        message: HOUSEHOLD_MESSAGES.kraPin('Mary Kennedy'),
      },
    ]);
  });
});
