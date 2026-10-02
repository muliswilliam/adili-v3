import { createHash } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq } from 'drizzle-orm';

import { Clock } from '../../clock.js';
import { config } from '../../config.js';
import { commissions, type DirectorySchema } from '../../db/schema.js';
import { actingTenantContext } from '../../internal-api.js';
import { onboardingInvitations, rosterRecords } from '../schema.js';
import {
  InvitationDelivery,
  InvitationDeliveryUnavailable,
  type InvitationMessage,
} from './invitation-delivery.js';
import type { OnboardingInvitation } from './representation.js';

/** The same message of the same invitation always carries the same key. */
function messageKey(slug: string, idempotencyKey: string, channel: string): string {
  return createHash('sha256')
    .update(`onboarding-invitation:${slug}:${idempotencyKey}:${channel}`)
    .digest('hex');
}

type InvitationRow = typeof onboardingInvitations.$inferSelect;

/**
 * Invitations to set up a declarant account, sent to the contacts a Commission's roster holds for
 * an officer who has not onboarded (spec 10: an access request names them, and the Commission
 * must reach them; it serves its notice in writing meanwhile, r.22(2)). The roster's email and
 * phone stay in the directory: the caller learns only which channels the invitation went out on.
 */
@Injectable()
export class OnboardingInvitationsService {
  private readonly logger = new Logger(OnboardingInvitationsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DirectorySchema>,
    private readonly delivery: InvitationDelivery,
    private readonly clock: Clock,
  ) {}

  /**
   * Invites the officer of roster record `recordId` to onboard, by email and SMS to the roster's
   * contacts (whichever it holds; none is an invitation on no channel). Once per
   * `idempotencyKey`: a retry returns the same invitation, and notifications sends each message
   * once. 404 when the Commission has no such record; 409 `already-onboarded` when it has
   * onboarded.
   */
  async invite(
    principal: Principal,
    tenant: string,
    slug: string,
    recordId: string,
    idempotencyKey: string,
  ): Promise<OnboardingInvitation> {
    const context = actingTenantContext(principal, tenant, slug);
    const found = await withTenant(this.db, context, async (tx) => {
      const [previous] = await tx
        .select()
        .from(onboardingInvitations)
        .where(
          and(
            eq(onboardingInvitations.tenant, slug),
            eq(onboardingInvitations.idempotencyKey, idempotencyKey),
          ),
        );
      const [record] = await tx
        .select({
          id: rosterRecords.id,
          personId: rosterRecords.personId,
          email: rosterRecords.email,
          phone: rosterRecords.phone,
          commissionName: commissions.name,
        })
        .from(rosterRecords)
        .innerJoin(commissions, eq(commissions.slug, rosterRecords.tenant))
        .where(and(eq(rosterRecords.id, recordId), eq(rosterRecords.tenant, slug)));
      return { previous, record };
    });
    const record = notFoundIfInvisible(found.record);
    if (found.previous && found.previous.rosterRecordId === record.id) {
      return toInvitation(found.previous);
    }
    if (record.personId !== null) throw ProblemException.fromCode('already-onboarded');

    const getStartedUrl = `${config.PORTAL_URL.replace(/\/+$/, '')}/get-started?commission=${encodeURIComponent(slug)}`;
    const contacts: Pick<InvitationMessage, 'channel' | 'to'>[] = [
      ...(record.email === null ? [] : [{ channel: 'email' as const, to: record.email }]),
      ...(record.phone === null ? [] : [{ channel: 'sms' as const, to: record.phone }]),
    ];
    const channels: InvitationMessage['channel'][] = [];
    for (const contact of contacts) {
      const sent = await this.send({
        ...contact,
        commissionName: record.commissionName,
        getStartedUrl,
        tenant: slug,
        idempotencyKey: messageKey(slug, idempotencyKey, contact.channel),
      });
      if (sent === 'sent') {
        channels.push(contact.channel);
      } else {
        this.logger.warn({ recordId, channel: contact.channel }, 'Invitation not delivered');
      }
    }

    const row = await withTenant(this.db, context, async (tx) => {
      const [inserted] = await tx
        .insert(onboardingInvitations)
        .values({
          tenant: slug,
          rosterRecordId: record.id,
          idempotencyKey,
          requestedBy: principal.clientId ?? principal.subject,
          channels,
          sentAt: this.clock.now(),
        })
        .onConflictDoNothing({
          target: [onboardingInvitations.tenant, onboardingInvitations.idempotencyKey],
        })
        .returning();
      if (inserted) return inserted;
      // A concurrent retry recorded it first.
      const [existing] = await tx
        .select()
        .from(onboardingInvitations)
        .where(
          and(
            eq(onboardingInvitations.tenant, slug),
            eq(onboardingInvitations.idempotencyKey, idempotencyKey),
          ),
        );
      if (!existing) throw new Error('The invitation was not recorded');
      return existing;
    });
    return toInvitation(row);
  }

  /** One message; notifications unreachable is 503 (the caller retries with the same key). */
  private async send(message: InvitationMessage): Promise<'sent' | 'failed'> {
    try {
      return await this.delivery.send(message);
    } catch (error) {
      if (!(error instanceof InvitationDeliveryUnavailable)) throw error;
      throw new ProblemException({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The invitation cannot be sent right now. Try again shortly.',
      });
    }
  }
}

function toInvitation(row: InvitationRow): OnboardingInvitation {
  return {
    id: row.id,
    rosterRecordId: row.rosterRecordId,
    channels: row.channels,
    sentAt: row.sentAt.toISOString(),
  };
}
