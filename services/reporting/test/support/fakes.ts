import { randomUUID } from 'node:crypto';

import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type OfficerDetails,
} from '../../src/declarations/declarations-client.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type StaffMember,
  type StaffRole,
} from '../../src/directory/directory-client.js';
import {
  DocumentsClient,
  type IssuedDocument,
  type IssueDocumentRequest,
} from '../../src/documents/documents-client.js';
import {
  NotificationsClient,
  type SentMessage,
  type StaffEmail,
} from '../../src/notifications/notifications-client.js';
import {
  type IcmsReferral,
  type IcmsReferralRequest,
  IntegrationGatewayClient,
  IntegrationGatewayUnavailable,
} from '../../src/integration-gateway/integration-gateway-client.js';
import { InternalApiRejected } from '../../src/internal-api/internal-api.js';
import {
  OpenDataFileMissing,
  OpenDataFiles,
  OpenDataStorageUnavailable,
} from '../../src/open-data/open-data-files.js';
import {
  type ClarificationDetails,
  type ReferralIcmsPayload,
  ReviewClient,
  ReviewUnavailable,
} from '../../src/review/review-client.js';

/**
 * The other services the reporting service reads from, for tests: each holds what a test gives
 * it per Commission and records what it was asked.
 */

/** The declarations internal batch details: officers by obligation, per Commission. */
export class FakeDeclarations extends DeclarationsClient {
  /** Each call: the Commission and how many ids it asked for. */
  readonly calls: { tenant: string; ids: number }[] = [];
  private readonly officers = new Map<string, OfficerDetails & { tenant: string }>();
  private failures = 0;

  given(tenant: string, ...officers: OfficerDetails[]): void {
    for (const officer of officers) this.officers.set(officer.obligationId, { ...officer, tenant });
  }

  /** The next `count` calls fail, as a declarations outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.calls.length = 0;
    this.officers.clear();
    this.failures = 0;
  }

  officerDetails(tenant: string, obligationIds: string[]): Promise<OfficerDetails[]> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new DeclarationsUnavailable('The declarations service is unreachable'));
    }
    this.calls.push({ tenant, ids: obligationIds.length });
    const found = obligationIds.flatMap((id) => {
      const officer = this.officers.get(id);
      if (!officer) return [];
      const { tenant: owner, ...details } = officer;
      return owner === tenant ? [details] : [];
    });
    return Promise.resolve(found);
  }
}

/**
 * The review internal API: clarification batch details by id, and referrals' ICMS payloads, per
 * Commission.
 */
export class FakeReview extends ReviewClient {
  readonly calls: { tenant: string; ids: number }[] = [];
  /** Each ICMS payload asked for: the Commission and the referral. */
  readonly payloadCalls: { tenant: string; referralId: string; actingSubject: string }[] = [];
  private readonly clarifications = new Map<string, ClarificationDetails & { tenant: string }>();
  private readonly referrals = new Map<string, { tenant: string; payload: ReferralIcmsPayload }>();
  private payloadFailures = 0;
  private payloadRefusals = 0;

  givenReferral(tenant: string, referralId: string, payload: ReferralIcmsPayload): void {
    this.referrals.set(referralId, { tenant, payload });
  }

  /** The next `count` ICMS payload reads fail, as a review outage would. */
  failPayloads(count: number): void {
    this.payloadFailures = count;
  }

  /** The next `count` ICMS payload reads are refused (409), as for an unknown roster record. */
  refusePayloads(count: number): void {
    this.payloadRefusals = count;
  }

  referralIcmsPayload(
    tenant: string,
    referralId: string,
    actingSubject: string,
  ): Promise<ReferralIcmsPayload | null> {
    this.payloadCalls.push({ tenant, referralId, actingSubject });
    if (this.payloadRefusals > 0) {
      this.payloadRefusals -= 1;
      return Promise.reject(new InternalApiRejected('review', 409));
    }
    if (this.payloadFailures > 0) {
      this.payloadFailures -= 1;
      return Promise.reject(new ReviewUnavailable('The review service is unreachable'));
    }
    const found = this.referrals.get(referralId);
    if (found?.tenant !== tenant) return Promise.resolve(null);
    return Promise.resolve(structuredClone(found.payload));
  }

  given(tenant: string, ...clarifications: ClarificationDetails[]): void {
    for (const found of clarifications) {
      this.clarifications.set(found.clarificationId, { ...found, tenant });
    }
  }

  reset(): void {
    this.calls.length = 0;
    this.payloadCalls.length = 0;
    this.clarifications.clear();
    this.referrals.clear();
    this.payloadFailures = 0;
    this.payloadRefusals = 0;
  }

  clarificationDetails(
    tenant: string,
    clarificationIds: string[],
  ): Promise<ClarificationDetails[]> {
    this.calls.push({ tenant, ids: clarificationIds.length });
    return Promise.resolve(
      clarificationIds.flatMap((id) => {
        const found = this.clarifications.get(id);
        if (!found) return [];
        const { tenant: owner, ...details } = found;
        return owner === tenant ? [details] : [];
      }),
    );
  }
}

/** Names of the Commissions tests use. */
const NAMES: Record<string, string> = {
  psc: 'Public Service Commission',
  tsc: 'Teachers Service Commission',
  jsc: 'Judicial Service Commission',
};

function commissionFacts(slug: string): CommissionFacts {
  return {
    slug,
    issuerCode: slug.toUpperCase(),
    name: NAMES[slug] ?? `${slug.toUpperCase()} Commission`,
  };
}

/** The directory: Commissions and their staff by role. */
export class FakeDirectory extends DirectoryClient {
  private readonly commissions = new Set<string>();
  private readonly staff: (StaffMember & { slug: string; role: string })[] = [];
  private failures = 0;

  givenCommission(slug: string): void {
    this.commissions.add(slug);
  }

  givenStaff(slug: string, role: string, subject: string, email: string): void {
    this.staff.push({ slug, role, subject, email });
  }

  reset(): void {
    this.commissions.clear();
    this.staff.length = 0;
    this.failures = 0;
  }

  /** The next `count` calls fail, as a directory outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  getCommission(slug: string): Promise<CommissionFacts> {
    if (this.failed()) return Promise.reject(new DirectoryUnavailable('Unreachable'));
    return this.commissions.has(slug)
      ? Promise.resolve(commissionFacts(slug))
      : Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
  }

  listCommissions(): Promise<CommissionFacts[]> {
    if (this.failed()) return Promise.reject(new DirectoryUnavailable('Unreachable'));
    return Promise.resolve([...this.commissions].sort().map(commissionFacts));
  }

  private failed(): boolean {
    if (this.failures === 0) return false;
    this.failures -= 1;
    return true;
  }

  staffWithRole(slug: string, role: StaffRole): Promise<StaffMember[]> {
    return Promise.resolve(
      this.staff
        .filter((member) => member.slug === slug && member.role === role)
        .map(({ subject, email }) => ({ subject, email })),
    );
  }
}

/**
 * The notifications messages API: every message is recorded as sent, once per idempotency key,
 * as the real service replays a repeated key.
 */
export class FakeNotifications extends NotificationsClient {
  readonly sent: StaffEmail[] = [];
  private readonly byKey = new Map<string, SentMessage>();

  reset(): void {
    this.sent.length = 0;
    this.byKey.clear();
  }

  send(message: StaffEmail): Promise<SentMessage> {
    const replayed = this.byKey.get(message.idempotencyKey);
    if (replayed) return Promise.resolve(replayed);
    const sent: SentMessage = { id: randomUUID(), status: 'sent', error: null };
    this.byKey.set(message.idempotencyKey, sent);
    this.sent.push(structuredClone(message));
    return Promise.resolve(sent);
  }
}

/**
 * The documents issue API with its templates faked: every request is recorded and answered with a
 * new document, once per idempotency key, as the real service replays a repeated key.
 */
export class FakeDocuments extends DocumentsClient {
  readonly issued: IssueDocumentRequest[] = [];
  private readonly byKey = new Map<string, IssuedDocument>();
  private failures = 0;

  /** The next `count` calls fail, as a documents outage would. */
  failCalls(count: number): void {
    this.failures = count;
  }

  reset(): void {
    this.issued.length = 0;
    this.byKey.clear();
    this.failures = 0;
  }

  issue(request: IssueDocumentRequest): Promise<IssuedDocument> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('The documents service is unreachable'));
    }
    const replayed = this.byKey.get(request.idempotencyKey);
    if (replayed) return Promise.resolve(replayed);
    const issued = { id: randomUUID(), verificationId: `ADL-${randomUUID().slice(0, 8)}` };
    this.byKey.set(request.idempotencyKey, issued);
    this.issued.push(structuredClone(request));
    return Promise.resolve(issued);
  }
}

/**
 * The integration-gateway's ICMS adapter with ICMS faked: registers each referral once by its
 * reference (a replay answers the stored registration, as the adapter does), with a case number
 * at once, or `pending` until a test registers it. Records every request that reached ICMS.
 */
export class FakeIntegrationGateway extends IntegrationGatewayClient {
  /** Every `submitReferral` request that reached ICMS, with the Commission it was sent for. */
  readonly submitted: IcmsReferralRequest[] = [];
  /** How many `submitReferral` calls were made, failed and replayed ones included. */
  submitCalls = 0;
  private readonly registrations = new Map<string, IcmsReferral>();
  private mode: IcmsReferral['status'] = 'registered';
  private failures = 0;
  private rejections = 0;
  private sequence = 0;

  /** How ICMS answers new referrals from now: a case number at once, pending, or failed. */
  answer(mode: IcmsReferral['status']): void {
    this.mode = mode;
  }

  /** The next `count` calls fail, as an ICMS or gateway outage would (503). */
  failCalls(count: number): void {
    this.failures = count;
  }

  /** The next `count` submissions are refused (a 4xx from the gateway). */
  rejectCalls(count: number): void {
    this.rejections = count;
  }

  /** ICMS registers a pending referral under `caseNumber`. */
  register(referralReference: string, caseNumber: string, registeredAt: string): void {
    const found = this.registrations.get(referralReference);
    if (!found) throw new Error(`ICMS holds no referral ${referralReference}`);
    this.registrations.set(referralReference, {
      ...found,
      status: 'registered',
      caseNumber,
      registeredAt,
    });
  }

  reset(): void {
    this.submitted.length = 0;
    this.submitCalls = 0;
    this.registrations.clear();
    this.mode = 'registered';
    this.failures = 0;
    this.rejections = 0;
    this.sequence = 0;
  }

  submitReferral(referral: IcmsReferralRequest): Promise<IcmsReferral> {
    this.submitCalls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('ICMS is unreachable'));
    }
    if (this.rejections > 0) {
      this.rejections -= 1;
      return Promise.reject(new InternalApiRejected('integration-gateway', 400));
    }
    const replayed = this.registrations.get(referral.referralReference);
    if (replayed) return Promise.resolve({ ...replayed });
    this.submitted.push(structuredClone(referral));
    this.sequence += 1;
    const now = new Date().toISOString();
    const registered = this.mode === 'registered';
    const registration: IcmsReferral = {
      referralReference: referral.referralReference,
      caseNumber: registered ? `ICMS/2028/${String(this.sequence).padStart(6, '0')}` : null,
      status: this.mode,
      registeredAt: registered ? now : null,
      sentAt: now,
    };
    this.registrations.set(referral.referralReference, registration);
    return Promise.resolve({ ...registration });
  }

  getReferral(referralReference: string): Promise<IcmsReferral | null> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new IntegrationGatewayUnavailable('ICMS is unreachable'));
    }
    const found = this.registrations.get(referralReference);
    return Promise.resolve(found ? { ...found } : null);
  }
}

/**
 * The open-data bucket in memory: objects by key with their content type; `failCalls(n)` makes
 * the next writes fail as an unreachable storage would.
 */
export class FakeOpenDataFiles extends OpenDataFiles {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  private failures = 0;

  reset(): void {
    this.objects.clear();
    this.failures = 0;
  }

  failCalls(count: number): void {
    this.failures = count;
  }

  put(file: { key: string; body: Uint8Array; contentType: string }): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new OpenDataStorageUnavailable('Unreachable'));
    }
    this.objects.set(file.key, { body: Buffer.from(file.body), contentType: file.contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    return object
      ? Promise.resolve(new Uint8Array(object.body))
      : Promise.reject(new OpenDataFileMissing(`No object ${key}`));
  }
}
