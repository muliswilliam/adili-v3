import { randomUUID } from 'node:crypto';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type DisclosureDocument,
  type DisclosureRequest,
  type FullDocumentRequest,
  type VersionDocument,
} from '../../src/declarations/declarations-client.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type RosterRecordFacts,
  type StaffMember,
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

/** The directory: Commissions, roster records and staff, per Commission. */
export class FakeDirectory extends DirectoryClient {
  readonly calls: { method: string; slug: string }[] = [];
  private readonly commissions = new Map<string, CommissionFacts>();
  private readonly records = new Map<string, RosterRecordFacts & { slug: string }>();
  private readonly staff = new Map<string, StaffMember[]>();
  private readonly failures = new Failures();

  givenCommission(slug: string, name = `${slug.toUpperCase()} Commission`): CommissionFacts {
    const commission = { slug, issuerCode: slug.toUpperCase(), name };
    this.commissions.set(slug, commission);
    return commission;
  }

  givenRosterRecord(slug: string, record: Partial<RosterRecordFacts> = {}): RosterRecordFacts {
    const found: RosterRecordFacts = {
      id: record.id ?? randomUUID(),
      personnelFileNumber: record.personnelFileNumber ?? 'PF-0001',
      fullName: record.fullName ?? 'Anne Njeri Mutua',
      personId: record.personId === undefined ? randomUUID() : record.personId,
    };
    this.records.set(found.id, { ...found, slug });
    return found;
  }

  givenStaff(slug: string, role: string, ...members: StaffMember[]): void {
    this.staff.set(`${slug}:${role}`, members);
  }

  /** The next `count` calls fail, as a directory outage would. */
  failCalls(count: number): void {
    this.failures.next(count);
  }

  reset(): void {
    this.calls.length = 0;
    this.commissions.clear();
    this.records.clear();
    this.staff.clear();
    this.failures.reset();
  }

  findCommission(slug: string): Promise<CommissionFacts | null> {
    return this.answer('findCommission', slug, () => this.commissions.get(slug) ?? null);
  }

  listCommissions(): Promise<CommissionFacts[]> {
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

  staffWithRole(slug: string, role: string): Promise<StaffMember[]> {
    return this.answer('staffWithRole', slug, () => this.staff.get(`${slug}:${role}`) ?? []);
  }

  private answer<T>(method: string, slug: string, value: () => T): Promise<T> {
    this.calls.push({ method, slug });
    if (this.failures.take()) {
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
    return Promise.resolve(
      this.documents.get(`${request.declarationId}:${String(request.version)}`) ?? null,
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
    const issued = { id: randomUUID(), verificationId: `ADL-TEST-${String(this.issued.length)}` };
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
