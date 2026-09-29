import { randomUUID } from 'node:crypto';

import type { DeclarationV1 } from '@adili/forms';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type ObligationFacts,
  type PersonObligation,
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

/** A filing obligation held by the fake, with the Commission it belongs to. */
export interface StoredObligation extends ObligationFacts {
  tenant: string;
}

/** An overdue biennial obligation of an onboarded officer of `tenant`, unless said otherwise. */
export function overdueObligation(
  fixture: Partial<StoredObligation> & { tenant: string },
): StoredObligation {
  return {
    obligationId: randomUUID(),
    rosterRecordId: randomUUID(),
    personId: randomUUID(),
    type: 'biennial',
    cycleKey: 'biennial:2027',
    dueDate: '2027-12-31',
    status: 'overdue',
    declarantName: 'Grace Wanjiru',
    personnelFileNumber: `${fixture.tenant.toUpperCase()}/${randomUUID().slice(0, 6)}`,
    ...fixture,
  };
}

/**
 * One cycle of a person's obligation history: a biennial obligation of `year` due on 31 December,
 * overdue and unfiled unless said otherwise.
 */
export function biennialObligation(
  year: number,
  fixture: Partial<PersonObligation> = {},
): PersonObligation {
  return {
    obligationId: randomUUID(),
    type: 'biennial',
    cycleKey: `biennial:${String(year)}`,
    status: 'overdue',
    dueDate: `${String(year)}-12-31`,
    filedAt: null,
    late: false,
    ...fixture,
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
  private readonly obligations = new Map<string, StoredObligation>();
  /** Person obligation histories by `<tenant>:<personId>`. */
  private readonly histories = new Map<string, PersonObligation[]>();
  /** Every person obligation history read: whose, at which Commission. */
  readonly historyReads: { personId: string; tenant: string }[] = [];
  private failures = 0;

  given(...versions: StoredVersion[]): void {
    this.versions.push(...versions);
  }

  givenObligation(...obligations: StoredObligation[]): void {
    for (const obligation of obligations) {
      this.obligations.set(obligation.obligationId, structuredClone(obligation));
    }
  }

  /** A person's obligation history at a Commission (spec 08 BE-4), replacing any given before. */
  givenPersonObligations(tenant: string, personId: string, ...history: PersonObligation[]): void {
    this.histories.set(`${tenant}:${personId}`, structuredClone(history));
  }

  /** The obligation moves on (filed, cancelled), as spec 04's engine would move it. */
  setObligationStatus(obligationId: string, status: StoredObligation['status']): void {
    const found = this.obligations.get(obligationId);
    if (!found) throw new Error(`No obligation ${obligationId}`);
    found.status = status;
  }

  /** The next `count` reads (document or lookup) fail. */
  failReads(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.reads.length = 0;
    this.versions.length = 0;
    this.obligations.clear();
    this.histories.clear();
    this.historyReads.length = 0;
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

  getObligation(obligationId: string, tenant: string): Promise<ObligationFacts | null> {
    if (this.failing()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    const found = this.obligations.get(obligationId);
    if (found?.tenant !== tenant) return Promise.resolve(null);
    const pulled: Partial<StoredObligation> = structuredClone(found);
    delete pulled.tenant;
    return Promise.resolve(pulled as ObligationFacts);
  }

  listPersonObligations(personId: string, tenant: string): Promise<PersonObligation[]> {
    if (this.failing()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    this.historyReads.push({ personId, tenant });
    return Promise.resolve(structuredClone(this.histories.get(`${tenant}:${personId}`) ?? []));
  }

  private failing(): boolean {
    if (this.failures === 0) return false;
    this.failures -= 1;
    return true;
  }
}
