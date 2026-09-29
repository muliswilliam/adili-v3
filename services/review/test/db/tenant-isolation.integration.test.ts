import { randomUUID } from 'node:crypto';

import { withTenant } from '@adili/data-access';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clarifications, reviewCases, reviewFlags, reviewTimeline } from '../../src/db/schema.js';
import { type ReviewApi, startReviewApi } from '../support/review-api.js';

/** Row-level security of the review tables (ADR-006). */
describe('review tables under row-level security', () => {
  let api: ReviewApi;
  let caseId: string;
  const personId = randomUUID();

  beforeAll(async () => {
    api = await startReviewApi();
    api.directory.givenCommission('psc');
    ({ caseId } = await api.activities.upsertCase({
      input: { tenant: 'psc', declarationId: randomUUID(), versionId: randomUUID(), version: 1 },
      facts: {
        personId,
        reference: 'DEC-PSC-2027-0000009-2',
        type: 'biennial',
        statementDate: '2027-11-01',
        submittedAt: '2027-12-01T08:00:00Z',
        late: false,
        dueDate: '2027-12-31',
        declarantName: 'James Otieno',
        personnelFileNumber: 'PSC/0009',
      },
      flags: [
        {
          ruleId: 'no-previous-version',
          severity: 'info',
          title: 'First declaration',
          indicator: 'Nothing to compare with.',
          evidence: {},
          itemRefs: [],
        },
      ],
    }));
    await api.asPlatform((tx) =>
      tx.insert(clarifications).values({
        id: randomUUID(),
        tenant: 'psc',
        caseId,
        personId,
        status: 'draft',
        items: [],
        createdBy: 'reviewer-a',
      }),
    );
  });

  afterAll(async () => {
    await api.close();
  });

  it("another Commission's transactions see none of the rows and cannot write them", async () => {
    await withTenant(api.db, { tenant: 'tsc', subject: 'test' }, async (tx) => {
      expect(await tx.select().from(reviewCases)).toEqual([]);
      expect(await tx.select().from(reviewFlags)).toEqual([]);
      expect(await tx.select().from(reviewTimeline)).toEqual([]);
      expect(await tx.select().from(clarifications)).toEqual([]);
    });
    await expect(
      withTenant(api.db, { tenant: 'tsc', subject: 'test' }, (tx) =>
        tx.insert(reviewTimeline).values({
          id: randomUUID(),
          tenant: 'psc',
          caseId,
          kind: 'note-added',
          actor: 'test',
          summary: 'written across tenants',
        }),
      ),
    ).rejects.toThrow();
  });

  it("the Commission's own transactions see its rows", async () => {
    await withTenant(api.db, { tenant: 'psc', subject: 'test' }, async (tx) => {
      expect(await tx.select().from(reviewCases)).toHaveLength(1);
      expect(await tx.select().from(reviewFlags)).toHaveLength(1);
    });
  });

  it('a declarant reads their own clarifications, and no case data', async () => {
    const read = (person: string) =>
      api.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.person', ${person}, true)`);
        return {
          clarifications: await tx.select().from(clarifications),
          cases: await tx.select().from(reviewCases),
        };
      });

    const own = await read(personId);
    expect(own.clarifications).toHaveLength(1);
    expect(own.cases).toEqual([]);
    expect((await read(randomUUID())).clarifications).toEqual([]);
  });
});
