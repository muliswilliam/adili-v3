import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { tenantPolicyCache } from '../../src/db/schema.js';
import { DirectoryUnavailable } from '../../src/directory/directory-client.js';
import { POLICY_CHANGED, ROSTER_IMPORT_COMPLETED } from '../../src/obligations/events.js';
import {
  type DeclarationsApi,
  directoryEvent,
  startDeclarationsApi,
} from '../support/declarations-api.js';
import { policyVersion, rosterRecord } from '../support/fake-directory.js';

/**
 * `directory.policy.changed.v1` (spec 04 BE-2): the Commission's cached policy is pulled again, so
 * the next ingest, cycle opening and summary use the version in force. Idempotent (inbox).
 */
let api: DeclarationsApi;

beforeAll(async () => {
  api = await startDeclarationsApi();
});

afterAll(async () => {
  await api.close();
});

beforeEach(async () => {
  await api.reset();
  api.clock.setToday('2027-07-10');
  api.directory.givenCommission('psc', 'Public Service Commission');
  const importId = randomUUID();
  api.directory.givenImport(importId, [rosterRecord('psc')]);
  await api.consumers.importCompleted(
    directoryEvent(ROSTER_IMPORT_COMPLETED, 'psc', { importId, channel: 'file' }),
  );
});

async function cached() {
  const [row] = await api.asPlatform((tx) =>
    tx.select().from(tenantPolicyCache).where(eq(tenantPolicyCache.tenant, 'psc')),
  );
  return row;
}

function policyChanged(version: ReturnType<typeof policyVersion>) {
  return directoryEvent(POLICY_CHANGED, 'psc', {
    policyVersionId: version.id,
    version: version.version,
  });
}

describe('directory.policy.changed.v1', () => {
  it("refreshes the Commission's cached policy with the version in force", async () => {
    const v2 = policyVersion({ version: 2, obligationsStartDate: '2020-01-01' });
    api.directory.givenCommission('psc', 'Public Service Commission', v2);

    await api.consumers.policyChanged(policyChanged(v2));

    expect(await cached()).toMatchObject({
      policyVersionId: v2.id,
      version: 2,
      policy: { version: 2, obligationsStartDate: '2020-01-01' },
    });
  });

  it('is a no-op when the same event is delivered again', async () => {
    const v2 = policyVersion({ version: 2 });
    api.directory.givenCommission('psc', 'Public Service Commission', v2);
    const event = policyChanged(v2);
    await api.consumers.policyChanged(event);
    const first = await cached();

    // The directory has moved on, but a redelivery of the handled event pulls nothing.
    api.directory.givenCommission(
      'psc',
      'Public Service Commission',
      policyVersion({ version: 3 }),
    );
    await api.consumers.policyChanged(event);

    expect(await cached()).toEqual(first);
  });

  it('never puts an older version back', async () => {
    const v3 = policyVersion({ version: 3 });
    api.directory.givenCommission('psc', 'Public Service Commission', v3);
    await api.consumers.policyChanged(policyChanged(v3));

    const v2 = policyVersion({ version: 2 });
    api.directory.givenCommission('psc', 'Public Service Commission', v2);
    await api.consumers.policyChanged(policyChanged(v2));

    expect(await cached()).toMatchObject({ version: 3, policyVersionId: v3.id });
  });

  it('leaves the event for a retry when the directory cannot answer', async () => {
    const v2 = policyVersion({ version: 2 });
    api.directory.reset();

    await expect(api.consumers.policyChanged(policyChanged(v2))).rejects.toBeInstanceOf(
      DirectoryUnavailable,
    );
    expect(await cached()).toMatchObject({ version: 1 });
  });
});
