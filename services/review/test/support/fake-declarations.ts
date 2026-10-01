import { randomUUID } from 'node:crypto';

import type { DeclarationV1 } from '@adili/forms';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PreviousVersionRef,
  type PulledVersion,
  type ReadContext,
} from '../../src/declarations/declarations-client.js';

/** A submitted version held by the fake, with the Commission it belongs to. */
export interface StoredVersion extends PulledVersion {
  tenant: string;
}

export type VersionFixture = Partial<Omit<StoredVersion, 'document'>> & {
  tenant: string;
  document: DeclarationV1;
};

/** A submitted version as the declarations service would give it; version 1 by default. */
export function submittedVersion(fixture: VersionFixture): StoredVersion {
  return {
    declarationId: randomUUID(),
    versionId: randomUUID(),
    version: 1,
    personId: randomUUID(),
    reference: `DEC-${fixture.tenant.toUpperCase()}-2027-${String(Math.floor(Math.random() * 9_000_000) + 1_000_000).padStart(7, '0')}-4`,
    type: 'biennial',
    statementDate: '2027-11-01',
    submittedAt: '2027-12-10T09:00:00.000Z',
    late: false,
    dueDate: '2027-12-31',
    declarantName: 'James Otieno',
    personnelFileNumber: `${fixture.tenant.toUpperCase()}/${randomUUID().slice(0, 6)}`,
    attachments: [],
    ...fixture,
    document: fixture.document as unknown as Record<string, unknown>,
  };
}

/**
 * The declarations internal API for tests: submitted versions per Commission, the previous-version
 * lookup, and a record of every document read (who read it, for which case). `failReads` makes
 * the next reads fail, as a declarations outage would.
 */
export class FakeDeclarations extends DeclarationsClient {
  readonly reads: {
    declarationId: string;
    version: number;
    tenant: string;
    actingSubject: string;
    caseId: string | undefined;
  }[] = [];
  private readonly versions: StoredVersion[] = [];
  private failures = 0;

  given(...versions: StoredVersion[]): void {
    this.versions.push(...versions);
  }

  /** The next `count` reads (document or lookup) fail. */
  failReads(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.reads.length = 0;
    this.versions.length = 0;
    this.failures = 0;
  }

  getVersionDocument(
    declarationId: string,
    version: number,
    context: ReadContext,
  ): Promise<PulledVersion | null> {
    if (this.failing()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    this.reads.push({ declarationId, version, ...context, caseId: context.caseId });
    const found = this.versions.find(
      (stored) =>
        stored.declarationId === declarationId &&
        stored.version === version &&
        stored.tenant === context.tenant,
    );
    if (!found) return Promise.resolve(null);
    const pulled: Partial<StoredVersion> = structuredClone(found);
    delete pulled.tenant;
    return Promise.resolve(pulled as PulledVersion);
  }

  findPreviousVersion(
    personId: string,
    tenant: string,
    beforeVersionId: string,
  ): Promise<PreviousVersionRef | null> {
    if (this.failing()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    const before = this.versions.find((stored) => stored.versionId === beforeVersionId);
    if (!before) return Promise.resolve(null);
    const earlier = this.versions
      .filter(
        (stored) =>
          stored.personId === personId &&
          stored.tenant === tenant &&
          stored.submittedAt < before.submittedAt,
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return Promise.resolve(
      earlier
        ? {
            declarationId: earlier.declarationId,
            versionId: earlier.versionId,
            version: earlier.version,
            statementDate: earlier.statementDate,
            submittedAt: earlier.submittedAt,
          }
        : null,
    );
  }

  private failing(): boolean {
    if (this.failures === 0) return false;
    this.failures -= 1;
    return true;
  }
}
