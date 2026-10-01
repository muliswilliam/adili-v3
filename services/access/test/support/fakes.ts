import { randomUUID } from 'node:crypto';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type DisclosureDocument,
  type DisclosureRequest,
  type FullDocumentRequest,
  type PersonVersion,
  type VersionDocument,
} from '../../src/declarations/declarations-client.js';
import {
  type ApplicantFacts,
  type ApplicantIdentityStatus,
  type ApplicantVerificationInput,
  type CommissionFacts,
  type CommissionListing,
  DirectoryClient,
  DirectoryUnavailable,
  type LeaOfficerFacts,
  type RosterCandidateFacts,
  type RosterRecordFacts,
  ROSTER_SEARCH_LIMIT,
  type StaffMember,
  type StaffRole,
} from '../../src/directory/directory-client.js';
import {
  type CleanUpload,
  DocumentsClient,
  DocumentsUnavailable,
  type IssuedDocument,
  type IssueDocumentRequest,
  UploadNotClean,
  UploadNotFound,
} from '../../src/documents/documents-client.js';
import {
  type AccessMessage,
  NotificationsClient,
  NotificationsUnavailable,
  type SentMessage,
} from '../../src/notifications/notifications-client.js';

/**
 * The other services the access service calls, for tests: each holds what a test gives it,
 * records what it was asked, and fails the next calls when told to, as an outage would.
 */

/** Counts down failures: true while the next call should fail. */
class Failures {
  private remaining = 0;

  next(count: number): void {
    this.remaining = count;
  }

  take(): boolean {
    if (this.remaining === 0) return false;
    this.remaining -= 1;
    return true;
  }

  reset(): void {
    this.remaining = 0;
  }
}

/** The directory: Commissions, roster records and staff, per Commission, and applicants. */
export class FakeDirectory extends DirectoryClient {
  readonly calls: { method: string; slug: string }[] = [];
  /** Each verification recorded, as asked (a replayed key included). */
  readonly verifications: ApplicantVerificationInput[] = [];
  private readonly applicants = new Map<string, ApplicantIdentityStatus>();
  private failingMethod: string | undefined;
  private readonly commissions = new Map<string, CommissionListing>();
  private readonly records = new Map<string, RosterCandidateFacts & { slug: string }>();
  private readonly staff = new Map<string, StaffMember[]>();
  private readonly officers = new Map<string, LeaOfficerFacts>();
  private readonly failures = new Failures();

  /** An active Commission on Adili since 1 January 2025, unless `listing` says otherwise. */
  givenCommission(
    slug: string,
    name = `${slug.toUpperCase()} Commission`,
    listing: Partial<Pick<CommissionListing, 'status' | 'obligationsStartDate'>> = {},
  ): CommissionFacts {
    const commission = { slug, issuerCode: slug.toUpperCase(), name };
    this.commissions.set(slug, {
      ...commission,
      status: listing.status ?? 'active',
      obligationsStartDate: listing.obligationsStartDate ?? '2025-01-01',
    });
    return commission;
  }

  /** A roster record of the Commission, onboarded (with a person) unless `personId` is null. */
  givenRosterRecord(
    slug: string,
    record: Partial<RosterCandidateFacts> = {},
  ): RosterCandidateFacts {
    const personId = record.personId === undefined ? randomUUID() : record.personId;
    const found: RosterCandidateFacts = {
      id: record.id ?? randomUUID(),
      personnelFileNumber: record.personnelFileNumber ?? 'PF-0001',
      fullName: record.fullName ?? 'Anne Njeri Mutua',
      personId,
      designation: record.designation === undefined ? 'Senior Officer' : record.designation,
      reportingEntityName: record.reportingEntityName ?? null,
      state: record.state ?? (personId === null ? 'not_onboarded' : 'onboarded'),
    };
    this.records.set(found.id, { ...found, slug });
    return found;
  }

  givenStaff(slug: string, role: StaffRole, ...members: StaffMember[]): void {
    this.staff.set(`${slug}:${role}`, members);
  }

  /** An applicant person, verified (national ID matched by IPRS) unless said otherwise. */
  givenApplicant(personId: string, identityStatus: ApplicantIdentityStatus = 'verified'): void {
    this.applicants.set(personId, identityStatus);
  }

  /**
   * A law enforcement officer of the DCI, activated, whose account is `keycloakUserId`, unless
   * `officer` says otherwise.
   */
  givenLeaOfficer(
    personId: string,
    keycloakUserId: string,
    officer: Partial<Omit<LeaOfficerFacts, 'personId' | 'keycloakUserId'>> = {},
  ): LeaOfficerFacts {
    const found: LeaOfficerFacts = {
      personId,
      keycloakUserId,
      name: officer.name ?? 'Peter Mwangi',
      agency: officer.agency ?? {
        code: 'DCI',
        name: 'Directorate of Criminal Investigations',
        legalBasis: 'National Police Service Act, 2011, s.35',
      },
      state: officer.state ?? 'activated',
      activatedAt:
        officer.activatedAt === undefined
          ? new Date('2027-01-04T07:00:00.000Z')
          : officer.activatedAt,
    };
    this.officers.set(personId, found);
    return found;
  }

  /** The applicant's identity status as the directory now holds it. */
  identityStatusOf(personId: string): ApplicantIdentityStatus | undefined {
    return this.applicants.get(personId);
  }

  /** The next `count` calls (of `method` only, when given) fail, as a directory outage would. */
  failCalls(count: number, method?: string): void {
    this.failures.next(count);
    this.failingMethod = method;
  }

  reset(): void {
    this.calls.length = 0;
    this.verifications.length = 0;
    this.applicants.clear();
    this.failingMethod = undefined;
    this.commissions.clear();
    this.records.clear();
    this.staff.clear();
    this.officers.clear();
    this.failures.reset();
  }

  findCommission(slug: string): Promise<CommissionFacts | null> {
    return this.answer('findCommission', slug, () => {
      const found = this.commissions.get(slug);
      return found ? { slug: found.slug, issuerCode: found.issuerCode, name: found.name } : null;
    });
  }

  listCommissions(): Promise<CommissionListing[]> {
    return this.answer('listCommissions', '', () => [...this.commissions.values()]);
  }

  rosterRecord(slug: string, recordId: string): Promise<RosterRecordFacts | null> {
    return this.answer('rosterRecord', slug, () => {
      const found = this.records.get(recordId);
      if (found?.slug !== slug) return null;
      const { id, personnelFileNumber, fullName, personId } = found;
      return { id, personnelFileNumber, fullName, personId };
    });
  }

  /** As the directory searches: file number prefix or part of the name, by full name. */
  searchRoster(slug: string, search: string): Promise<RosterCandidateFacts[]> {
    return this.answer('searchRoster', slug, () => {
      const term = search.toLowerCase();
      return [...this.records.values()]
        .filter(
          (record) =>
            record.slug === slug &&
            (record.personnelFileNumber.toLowerCase().startsWith(term) ||
              record.fullName.toLowerCase().includes(term)),
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .slice(0, ROSTER_SEARCH_LIMIT)
        .map((record) => ({
          id: record.id,
          personnelFileNumber: record.personnelFileNumber,
          fullName: record.fullName,
          personId: record.personId,
          designation: record.designation,
          reportingEntityName: record.reportingEntityName,
          state: record.state,
        }));
    });
  }

  staffWithRole(slug: string, role: StaffRole): Promise<StaffMember[]> {
    return this.answer('staffWithRole', slug, () => this.staff.get(`${slug}:${role}`) ?? []);
  }

  applicant(personId: string, tenant: string): Promise<ApplicantFacts | null> {
    return this.answer('applicant', tenant, () => {
      const identityStatus = this.applicants.get(personId);
      return identityStatus === undefined ? null : { personId, identityStatus };
    });
  }

  verifyApplicantIdentity(input: ApplicantVerificationInput): Promise<ApplicantFacts | null> {
    return this.answer('verifyApplicantIdentity', input.tenant, () => {
      this.verifications.push({ ...input });
      if (!this.applicants.has(input.personId)) return null;
      this.applicants.set(input.personId, 'verified');
      return { personId: input.personId, identityStatus: 'verified' as const };
    });
  }

  leaOfficer(personId: string, tenant: string): Promise<LeaOfficerFacts | null> {
    return this.answer('leaOfficer', tenant, () => {
      const found = this.officers.get(personId);
      return found ? { ...found, agency: { ...found.agency } } : null;
    });
  }

  private answer<T>(method: string, slug: string, value: () => T): Promise<T> {
    this.calls.push({ method, slug });
    const failing = this.failingMethod === undefined || this.failingMethod === method;
    if (failing && this.failures.take()) {
      return Promise.reject(new DirectoryUnavailable('The directory is unreachable'));
    }
    return Promise.resolve(value());
  }
}

/** Declarations: scoped disclosures and full documents, as given per declarant. */
export class FakeDeclarations extends DeclarationsClient {
  /** Each disclosure asked for, as asked. */
  readonly disclosureCalls: DisclosureRequest[] = [];
  readonly fullDocumentCalls: FullDocumentRequest[] = [];
  readonly personVersionsCalls: { tenant: string; personId: string }[] = [];
  private readonly disclosures = new Map<string, DisclosureDocument>();
  private readonly documents = new Map<string, VersionDocument>();
  private readonly failures = new Failures();

  /** What a disclosure for `personId` returns (whatever the scope asked). */
  givenDisclosure(personId: string, disclosure: DisclosureDocument): void {
    this.disclosures.set(personId, disclosure);
  }

  givenFullDocument(document: VersionDocument): void {
    this.documents.set(`${document.declarationId}:${String(document.version)}`, document);
  }

  failCalls(count: number): void {
    this.failures.next(count);
  }

  reset(): void {
    this.disclosureCalls.length = 0;
    this.fullDocumentCalls.length = 0;
    this.personVersionsCalls.length = 0;
    this.disclosures.clear();
    this.documents.clear();
    this.failures.reset();
  }

  renderDisclosure(request: DisclosureRequest): Promise<DisclosureDocument | null> {
    this.disclosureCalls.push(structuredClone(request));
    if (this.failures.take()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    return Promise.resolve(this.disclosures.get(request.personId) ?? null);
  }

  fullDocument(request: FullDocumentRequest): Promise<VersionDocument | null> {
    this.fullDocumentCalls.push(structuredClone(request));
    if (this.failures.take()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    // As declarations: only a version of the person, at the acting Commission.
    const found = this.documents.get(`${request.declarationId}:${String(request.version)}`);
    const theirs = found?.personId === request.personId && found.commission.slug === request.tenant;
    return Promise.resolve(theirs ? found : null);
  }

  personVersions(tenant: string, personId: string): Promise<PersonVersion[]> {
    this.personVersionsCalls.push({ tenant, personId });
    if (this.failures.take()) {
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    // As declarations: the person's versions at the acting Commission, latest submitted first.
    const versions = [...this.documents.values()]
      .filter((found) => found.personId === personId && found.commission.slug === tenant)
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.version - a.version);
    return Promise.resolve(
      versions.map((found) => ({
        declarationId: found.declarationId,
        version: found.version,
        reference: found.reference,
        type: found.type,
        statementDate: found.statementDate,
        submittedAt: found.submittedAt,
        superseded: versions.some(
          (other) => other.declarationId === found.declarationId && other.version > found.version,
        ),
      })),
    );
  }
}

/** Documents: issues whatever it is asked (once per idempotency key) and holds clean uploads. */
export class FakeDocuments extends DocumentsClient {
  /** Each issue request, as asked (the first per idempotency key). */
  readonly issued: IssueDocumentRequest[] = [];
  readonly linked: string[] = [];
  readonly unlinked: string[] = [];
  private readonly byKey = new Map<string, IssuedDocument>();
  private readonly uploads = new Map<string, CleanUpload & { tenant: string; clean: boolean }>();
  private readonly failures = new Failures();

  /** `now` dates what it issues (the service's clock in the harness). */
  constructor(private readonly now: () => Date = () => new Date()) {
    super();
  }

  givenUpload(
    tenant: string,
    upload: Partial<CleanUpload> & { clean?: boolean } = {},
  ): CleanUpload {
    const found = {
      id: upload.id ?? randomUUID(),
      purpose: upload.purpose ?? 'access-representation',
      uploadedBy: upload.uploadedBy ?? randomUUID(),
      fileName: upload.fileName ?? 'representation.pdf',
    };
    this.uploads.set(found.id, { ...found, tenant, clean: upload.clean ?? true });
    return found;
  }

  failCalls(count: number): void {
    this.failures.next(count);
  }

  reset(): void {
    this.issued.length = 0;
    this.linked.length = 0;
    this.unlinked.length = 0;
    this.byKey.clear();
    this.uploads.clear();
    this.failures.reset();
  }

  issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    if (this.failures.take()) {
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    const existing = this.byKey.get(request.idempotencyKey);
    if (existing) return Promise.resolve(existing);
    this.issued.push(structuredClone(request));
    const issuedAt = this.now();
    const issued: IssuedDocument = {
      id: randomUUID(),
      verificationId: `ADL-TEST-${String(this.issued.length)}`,
      issuedAt,
      downloadExpiresAt:
        request.downloadWindowDays === undefined
          ? null
          : new Date(issuedAt.getTime() + request.downloadWindowDays * 24 * 60 * 60 * 1000),
    };
    this.byKey.set(request.idempotencyKey, issued);
    return Promise.resolve(issued);
  }

  getCleanUpload(tenant: string, uploadId: string): Promise<CleanUpload> {
    if (this.failures.take()) {
      return Promise.reject(new DocumentsUnavailable('The documents service is unreachable'));
    }
    const found = this.uploads.get(uploadId);
    if (found?.tenant !== tenant) return Promise.reject(new UploadNotFound(uploadId));
    if (!found.clean) return Promise.reject(new UploadNotClean(uploadId));
    const { id, purpose, uploadedBy, fileName } = found;
    return Promise.resolve({ id, purpose, uploadedBy, fileName });
  }

  markLinked(_tenant: string, uploadId: string): Promise<void> {
    this.linked.push(uploadId);
    return Promise.resolve();
  }

  markUnlinked(_tenant: string, uploadId: string): Promise<void> {
    this.unlinked.push(uploadId);
    return Promise.resolve();
  }
}

/** Notifications: records every message (once per idempotency key) and reports it sent. */
export class FakeNotifications extends NotificationsClient {
  readonly sent: AccessMessage[] = [];
  private readonly byKey = new Map<string, SentMessage>();
  private readonly failures = new Failures();

  failCalls(count: number): void {
    this.failures.next(count);
  }

  reset(): void {
    this.sent.length = 0;
    this.byKey.clear();
    this.failures.reset();
  }

  send(message: AccessMessage): Promise<SentMessage> {
    if (this.failures.take()) {
      return Promise.reject(
        new NotificationsUnavailable('The notifications service is unreachable'),
      );
    }
    const existing = this.byKey.get(message.idempotencyKey);
    if (existing) return Promise.resolve(existing);
    this.sent.push(structuredClone(message));
    const sent: SentMessage = { id: randomUUID(), status: 'sent', error: null };
    this.byKey.set(message.idempotencyKey, sent);
    return Promise.resolve(sent);
  }
}
