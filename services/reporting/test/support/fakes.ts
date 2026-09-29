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
} from '../../src/directory/directory-client.js';
import {
  NotificationsClient,
  type SentMessage,
  type StaffEmail,
} from '../../src/notifications/notifications-client.js';
import { type ClarificationDetails, ReviewClient } from '../../src/review/review-client.js';

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

/** The review internal batch details: clarifications by id, per Commission. */
export class FakeReview extends ReviewClient {
  readonly calls: { tenant: string; ids: number }[] = [];
  private readonly clarifications = new Map<string, ClarificationDetails & { tenant: string }>();

  given(tenant: string, ...clarifications: ClarificationDetails[]): void {
    for (const found of clarifications) {
      this.clarifications.set(found.clarificationId, { ...found, tenant });
    }
  }

  reset(): void {
    this.calls.length = 0;
    this.clarifications.clear();
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
};

/** The directory: Commissions and their staff by role. */
export class FakeDirectory extends DirectoryClient {
  private readonly commissions = new Set<string>();
  private readonly staff: (StaffMember & { slug: string; role: string })[] = [];

  givenCommission(slug: string): void {
    this.commissions.add(slug);
  }

  givenStaff(slug: string, role: string, subject: string, email: string): void {
    this.staff.push({ slug, role, subject, email });
  }

  reset(): void {
    this.commissions.clear();
    this.staff.length = 0;
  }

  getCommission(slug: string): Promise<CommissionFacts> {
    return this.commissions.has(slug)
      ? Promise.resolve({
          slug,
          issuerCode: slug.toUpperCase(),
          name: NAMES[slug] ?? `${slug.toUpperCase()} Commission`,
        })
      : Promise.reject(new DirectoryUnavailable(`No Commission ${slug}`));
  }

  staffWithRole(slug: string, role: string): Promise<StaffMember[]> {
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
