import { eq } from 'drizzle-orm';
import { vi } from 'vitest';

import { reviewCases } from '../../src/db/schema.js';
import type { ProcessingInput } from '../../src/processing/contract.js';
import { type StoredVersion, submittedVersion, type VersionFixture } from './fake-declarations.js';
import { type ReviewApi, submittedEvent } from './review-api.js';

/** The processing input of a submitted version, as `declaration.submitted.v1` carries it. */
export function processingInput(version: StoredVersion): ProcessingInput {
  return {
    tenant: version.tenant,
    declarationId: version.declarationId,
    versionId: version.versionId,
    version: version.version,
  };
}

/**
 * Version 1 of a declaration and version 2, its amendment: the same declaration, person and
 * reference. `second` sets what changed (document, submission time, name).
 */
export function twoVersions(
  first: VersionFixture,
  second: Omit<VersionFixture, 'tenant'>,
): { first: StoredVersion; second: StoredVersion } {
  const one = submittedVersion(first);
  const two = submittedVersion({
    tenant: one.tenant,
    declarationId: one.declarationId,
    personId: one.personId,
    reference: one.reference,
    declarantName: one.declarantName,
    personnelFileNumber: one.personnelFileNumber,
    version: 2,
    ...second,
  });
  return { first: one, second: two };
}

/**
 * Runs the processing workflow's steps for a version the fake declarations service holds, as the
 * worker would; returns the case.
 */
export async function processed(api: ReviewApi, version: StoredVersion): Promise<string> {
  const input = processingInput(version);
  const facts = await api.activities.pullVersion(input);
  if (!facts) throw new Error('version not pulled');
  const previous = await api.activities.pullPreviousVersion({
    tenant: input.tenant,
    personId: facts.personId,
    versionId: input.versionId,
  });
  const flags = await api.activities.runRules({ input, facts, previous });
  const { caseId } = await api.activities.upsertCase({ input, facts, flags });
  return caseId;
}

/**
 * Delivers `declaration.submitted.v1` for a version to the inbox and waits until the workflow on
 * Temporal has brought its case to that version; returns the case row.
 */
export async function processedFromInbox(api: ReviewApi, version: StoredVersion) {
  await api.consumer.submitted(submittedEvent(version.tenant, version));
  return vi.waitFor(
    async () => {
      const [found] = await api.asPlatform((tx) =>
        tx.select().from(reviewCases).where(eq(reviewCases.declarationId, version.declarationId)),
      );
      if (found?.currentVersion !== version.version) throw new Error('not processed yet');
      return found;
    },
    { timeout: 45_000, interval: 250 },
  );
}

/**
 * The case of a version the fake declarations service holds, with no flags, assigned to
 * `assignee` (claiming is the assignment slice's, so the row is arranged directly); null leaves it
 * unassigned.
 */
export async function givenAssignedCase(
  api: ReviewApi,
  version: StoredVersion,
  assignee: string | null = 'reviewer-a',
): Promise<string> {
  const input = processingInput(version);
  const facts = await api.activities.pullVersion(input);
  if (!facts) throw new Error('version not pulled');
  const { caseId } = await api.activities.upsertCase({ input, facts, flags: [] });
  if (assignee) {
    await api.asPlatform((tx) =>
      tx
        .update(reviewCases)
        .set({ status: 'assigned', assignee, assigneeName: assignee, claimedAt: new Date() })
        .where(eq(reviewCases.id, caseId)),
    );
  }
  return caseId;
}
