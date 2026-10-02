import { randomUUID } from 'node:crypto';

import {
  DirectoryClient,
  DirectoryUnavailable,
  type PulledCommission,
  type PulledPolicy,
  type PulledRosterRecord,
  type PulledRosterRecordPage,
  type RosterRecordSelector,
} from '../../src/directory/directory-client.js';

/** Version 1 of a Commission's policy with the platform defaults and the given start date. */
export function policyVersion(overrides: Partial<PulledPolicy> = {}): PulledPolicy {
  return {
    id: randomUUID(),
    version: 1,
    obligationsStartDate: '2027-01-01',
    initialDueAfterAppointmentDays: 30,
    biennial: { statementDate: '11-01', dueDate: '12-31' },
    finalDueAfterExitDays: 30,
    reminderOffsetsDays: [30, 14, 7],
    ...overrides,
  };
}

/** A roster record as the directory would give it: not onboarded unless a person is given. */
export function rosterRecord(
  tenant: string,
  overrides: Partial<PulledRosterRecord> = {},
): PulledRosterRecord {
  const id = overrides.id ?? randomUUID();
  return {
    id,
    tenant,
    personnelFileNumber: `${tenant.toUpperCase()}/${id.slice(0, 8)}`,
    fullName: 'Achieng Otieno',
    designation: 'Senior Accountant',
    jobGroup: null,
    workStation: null,
    maritalStatus: null,
    reportingEntity: { id: '0192f1a0-5a11-7000-8000-00000000e001', name: 'Ministry of Health' },
    state: overrides.personId ? 'onboarded' : 'not_onboarded',
    appointmentDate: '2015-01-05',
    exitDate: null,
    personId: null,
    ofr: null,
    onboardedAt: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * The directory's internal API for tests: Commissions, policies, records and the imports and exit
 * batches that touched them, pulled in pages of `pageSize` (1,000 like the directory). `failPull`
 * makes a chosen page pull fail once, as a directory outage would.
 */
export class FakeDirectory extends DirectoryClient {
  pageSize = 1000;
  /** Every page pull, in order: `<slug> <importId|exitBatchId> <cursor>`. */
  readonly pulls: string[] = [];
  private readonly commissions = new Map<string, PulledCommission>();
  private readonly policies = new Map<string, PulledPolicy>();
  private readonly records = new Map<string, PulledRosterRecord>();
  private readonly selections = new Map<string, string[]>();
  private failures: { page: number; remaining: number } | undefined;
  private readonly nationalIds = new Map<string, string>();
  /** Every national ID read, by record id: an audited read in the directory. */
  readonly nationalIdReads: string[] = [];

  givenCommission(slug: string, name: string, policy: PulledPolicy = policyVersion()): void {
    this.commissions.set(slug, { slug, issuerCode: slug.toUpperCase(), name });
    this.policies.set(slug, policy);
  }

  /** Records `records` (replacing earlier versions) as touched by import `importId`. */
  givenImport(importId: string, records: readonly PulledRosterRecord[]): void {
    this.givenRecords(records);
    this.selections.set(
      importId,
      records.map((record) => record.id),
    );
  }

  /** Records `records` (replacing earlier versions) as exited by confirmation `batchId`. */
  givenExitBatch(batchId: string, records: readonly PulledRosterRecord[]): void {
    this.givenImport(batchId, records);
  }

  /** Stores or replaces records without an import, e.g. a record changed by onboarding. */
  givenRecords(records: readonly PulledRosterRecord[]): void {
    for (const record of records) this.records.set(record.id, record);
  }

  /** The national ID the roster gives record `recordId`. */
  givenNationalId(recordId: string, nationalId: string): void {
    this.nationalIds.set(recordId, nationalId);
  }

  /** The next pull of page `page` (0-based) fails, once. */
  failPull(page: number): void {
    this.failures = { page, remaining: 1 };
  }

  reset(): void {
    this.pageSize = 1000;
    this.pulls.length = 0;
    this.commissions.clear();
    this.policies.clear();
    this.records.clear();
    this.selections.clear();
    this.failures = undefined;
    this.nationalIds.clear();
    this.nationalIdReads.length = 0;
  }

  listRosterRecords(
    slug: string,
    selector: RosterRecordSelector,
    cursor: string | null,
  ): Promise<PulledRosterRecordPage> {
    const selectionId = 'importId' in selector ? selector.importId : selector.exitBatchId;
    this.pulls.push(`${slug} ${selectionId} ${cursor ?? '-'}`);
    const offset = cursor === null ? 0 : Number(cursor);
    const page = offset / this.pageSize;
    if (this.failures?.page === page && this.failures.remaining > 0) {
      this.failures.remaining -= 1;
      return Promise.reject(new DirectoryUnavailable('The directory is unreachable'));
    }
    const ids = this.selections.get(selectionId);
    if (!ids) return Promise.reject(new DirectoryUnavailable('The directory answered 404'));
    const items = ids
      .slice(offset, offset + this.pageSize)
      .map((id) => this.records.get(id))
      .filter((record): record is PulledRosterRecord => record?.tenant === slug);
    const next = offset + this.pageSize;
    return Promise.resolve({ items, nextCursor: next < ids.length ? String(next) : null });
  }

  getRosterRecord(slug: string, recordId: string): Promise<PulledRosterRecord | null> {
    const record = this.records.get(recordId);
    return Promise.resolve(record?.tenant === slug ? record : null);
  }

  getRosterNationalId(slug: string, recordId: string): Promise<string | null> {
    this.nationalIdReads.push(recordId);
    const record = this.records.get(recordId);
    if (record?.tenant !== slug) return Promise.resolve(null);
    return Promise.resolve(this.nationalIds.get(recordId) ?? null);
  }

  getPolicy(slug: string): Promise<PulledPolicy> {
    const policy = this.policies.get(slug);
    return policy
      ? Promise.resolve(policy)
      : Promise.reject(new DirectoryUnavailable('The directory answered 404'));
  }

  listCommissions(): Promise<PulledCommission[]> {
    return Promise.resolve(
      [...this.commissions.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
    );
  }

  getCommission(slug: string): Promise<PulledCommission> {
    const commission = this.commissions.get(slug);
    return commission
      ? Promise.resolve(commission)
      : Promise.reject(new DirectoryUnavailable('The directory answered 404'));
  }
}
