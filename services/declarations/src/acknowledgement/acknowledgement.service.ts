import { Injectable, Logger } from '@nestjs/common';
import { errorType, notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
  InjectDatabase,
  switchTenant,
  withPerson,
  withTenant,
} from '@adili/data-access';
import { consumeOnce, type EventEnvelope, EventPublisher } from '@adili/events';
import {
  DECLARATION_ACKNOWLEDGED,
  DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
  type DeclarationAcknowledgedData,
  type DeclarationAcknowledgementRequestedData,
  type DocumentIssuedData,
  type VerificationCheckedData,
} from '@adili/events/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { v5 as uuidv5 } from 'uuid';

import { Clock } from '../clock.js';
import { config } from '../config.js';
import type { DeclarationsSchema } from '../db/schema.js';
import { personOf } from '../drafts/access.js';
import { declarations } from '../drafts/schema.js';
import {
  NotificationsClient,
  NotificationsKeyReused,
  NotificationsRejected,
  type MessageChannel,
} from '../notifications/notifications-client.js';
import { commissionRefs, filingObligations } from '../obligations/schema.js';
import { PLATFORM_CONTEXT, systemContext } from '../obligations/system-context.js';
import { deriveItems } from '../submission/items.js';
import type { Acknowledgement } from '../submission/representation.js';
import { declarationVersions } from '../submission/schema.js';
import { openSnapshot, versionRow } from '../submission/versions.js';
import type { AcknowledgementPayload } from './representation.js';
import { acknowledgementOf, reissueDecision } from './status.js';

/** The document type of acknowledgement slips in the documents service. */
export const ACKNOWLEDGEMENT_SLIP = 'acknowledgement-slip';
/** How a slip names the version it acknowledges: `declaration-version:<version id>`. */
const SUBJECT_PREFIX = 'declaration-version:';

/** Inbox consumers: the acknowledgement set on the version, then the declarant told. */
const ISSUED_CONSUMER = 'declarations.acknowledgement-issued';
const NOTIFIED_CONSUMER = 'declarations.acknowledgement-notified';
const CHECKED_CONSUMER = 'declarations.verification-checked';

/** Namespace of the acknowledgement messages' idempotency keys (UUID v5). */
const ACKNOWLEDGEMENT_KEY_NAMESPACE = '0c8e4a2f-6b1d-4f3e-9a75-3d2c1b0e9f84';
const CHANNELS: readonly MessageChannel[] = ['email', 'sms'];

type VersionRow = typeof declarationVersions.$inferSelect;

/** What the acknowledgement reads of `document.issued.v1`. */
export type IssuedDocument = Pick<
  DocumentIssuedData,
  | 'documentId'
  | 'verificationId'
  | 'verifyUrl'
  | 'documentType'
  | 'issuerTenant'
  | 'subjectRef'
  | 'issuedAt'
>;

/**
 * A version's acknowledgement slip (spec 06): what the documents service pulls to issue it, the
 * issued slip set on the version with the declarant told by email and SMS, how often its code was
 * looked up, and the declarant's view of it and ask to have it issued again.
 */
@Injectable()
export class AcknowledgementService {
  private readonly logger = new Logger(AcknowledgementService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: FieldCipher,
    private readonly events: EventPublisher,
    private readonly notifications: NotificationsClient,
    private readonly clock: Clock,
  ) {}

  /** The declarant's own version's acknowledgement; 404 for anyone else. */
  async get(
    principal: Principal,
    declarationId: string,
    version: number,
  ): Promise<Acknowledgement> {
    const row = await withPerson(this.db, personOf(principal), (tx) =>
      versionRow(tx, declarationId, version),
    );
    return acknowledgementOf(notFoundIfInvisible(row), this.clock.now());
  }

  /**
   * Asks the documents service for the slip again (`declaration.acknowledgement-requested.v1`),
   * once issuing it has failed: 409 when it is issued or still being prepared, 429
   * `resend-cooldown` while an earlier ask is.
   */
  async reissue(principal: Principal, declarationId: string, version: number): Promise<void> {
    const now = this.clock.now();
    const person = personOf(principal);
    await withPerson(this.db, person, async (tx) => {
      // The declarant's own version, read through the person axis; the ask is then recorded in
      // the Commission's context, the declarant never writing through it (ADR-018).
      const own = notFoundIfInvisible(await versionRow(tx, declarationId, version));
      await switchTenant(tx, { tenant: own.tenant, subject: person.subject });
      const row = notFoundIfInvisible(await versionRow(tx, declarationId, version, { lock: true }));
      const decision = reissueDecision(row, now);
      if (decision.kind === 'refused') {
        throw ProblemException.fromCode(decision.code, {
          detail:
            decision.code === 'acknowledgement-issued'
              ? 'The acknowledgement slip is issued; download it.'
              : 'The acknowledgement slip is still being prepared.',
        });
      }
      if (decision.kind === 'cooldown') {
        throw ProblemException.fromCode('resend-cooldown', {
          detail: 'The acknowledgement slip was asked for again a moment ago.',
          extensions: { retryAfterSeconds: decision.retryAfterSeconds },
        });
      }
      await tx
        .update(declarationVersions)
        .set({ ackRequestedAt: now })
        .where(
          and(eq(declarationVersions.id, row.id), eq(declarationVersions.cycleYear, row.cycleYear)),
        );
      await this.events.record(tx, {
        type: DECLARATION_ACKNOWLEDGEMENT_REQUESTED,
        subject: row.declarationId,
        tenant: row.tenant,
        data: {
          declarationId: row.declarationId,
          versionId: row.id,
          version: row.version,
          reference: row.reference,
        } satisfies DeclarationAcknowledgementRequestedData,
      });
    });
  }

  /**
   * What the slip of the tenant's version prints (for the documents service), with the declarant
   * it is issued for; 404 when the tenant has no such version. The name and the counts come from
   * the version's own snapshot, as declared.
   */
  async payload(
    tenant: string,
    subject: string,
    declarationId: string,
    version: number,
  ): Promise<AcknowledgementPayload> {
    const found = await withTenant(this.db, { tenant, subject }, async (tx) => {
      const row = await versionRow(tx, declarationId, version);
      if (!row) return null;
      const [context] = await tx
        .select({
          type: declarations.type,
          statementDate: declarations.statementDate,
          dueDate: filingObligations.dueDate,
          commissionName: commissionRefs.name,
          issuerCode: commissionRefs.issuerCode,
        })
        .from(declarations)
        .leftJoin(filingObligations, eq(filingObligations.id, declarations.obligationId))
        .leftJoin(commissionRefs, eq(commissionRefs.slug, declarations.tenant))
        .where(eq(declarations.id, row.declarationId));
      return context ? { row, context } : null;
    });
    const { row, context } = notFoundIfInvisible(found);
    if (context.commissionName === null || context.issuerCode === null) {
      // The read model has every Commission (CommissionRefs); a gap is transient: retry.
      throw new Error(`No Commission reference for ${row.tenant}`);
    }
    const document = await openSnapshot(this.cipher, row);
    const name = document.officer.name;
    return {
      declarantPersonId: row.personId,
      slip: {
        declarantName: [name.firstName, name.otherNames, name.surname]
          .map((part) => part?.trim())
          .filter(Boolean)
          .join(' '),
        commissionName: context.commissionName,
        issuerCode: context.issuerCode,
        declarationType: context.type,
        statementDate: context.statementDate,
        dueDate: context.dueDate,
        reference: row.reference,
        version: row.version,
        submittedAt: row.submittedAt.toISOString(),
        late: row.late,
        statementCount: document.statements.length,
        itemCount: deriveItems(document).length,
      },
    };
  }

  /**
   * `document.issued.v1` for an acknowledgement slip: sets it on the version it acknowledges and
   * records `declaration.acknowledged.v1` (once; a slip announced again changes nothing), then
   * tells the declarant by email and SMS. The two steps have inbox entries of their own, so a
   * notifications outage retries only the messages, and the declarant sees the slip meanwhile.
   * Each message keeps its `Idempotency-Key` per version and channel: never sent twice.
   */
  async issued(event: EventEnvelope, data: IssuedDocument): Promise<void> {
    if (data.documentType !== ACKNOWLEDGEMENT_SLIP || !data.subjectRef.startsWith(SUBJECT_PREFIX)) {
      return;
    }
    const versionId = data.subjectRef.slice(SUBJECT_PREFIX.length);
    const context = systemContext(data.issuerTenant);

    await consumeOnce(this.db, ISSUED_CONSUMER, event, async (tx) => {
      await switchTenant(tx, context);
      const [row] = await tx
        .select()
        .from(declarationVersions)
        .where(eq(declarationVersions.id, versionId))
        .for('update');
      if (!row) {
        this.logger.warn({ versionId, documentId: data.documentId }, 'Slip of an unknown version');
        return;
      }
      if (row.ackStatus === 'issued') return;
      await tx
        .update(declarationVersions)
        .set({
          ackStatus: 'issued',
          ackDocumentId: data.documentId,
          ackVerificationId: data.verificationId,
          ackVerifyUrl: data.verifyUrl,
          ackIssuedAt: new Date(data.issuedAt),
        })
        .where(
          and(eq(declarationVersions.id, row.id), eq(declarationVersions.cycleYear, row.cycleYear)),
        );
      await this.events.record(tx, {
        type: DECLARATION_ACKNOWLEDGED,
        subject: row.declarationId,
        tenant: row.tenant,
        data: {
          declarationId: row.declarationId,
          versionId: row.id,
          documentId: data.documentId,
          verificationId: data.verificationId,
        } satisfies DeclarationAcknowledgedData,
      });
    });

    await consumeOnce(this.db, NOTIFIED_CONSUMER, event, async (tx) => {
      await switchTenant(tx, context);
      const [found] = await tx
        .select({
          version: declarationVersions,
          type: declarations.type,
          statementDate: declarations.statementDate,
          commissionName: commissionRefs.name,
        })
        .from(declarationVersions)
        .innerJoin(declarations, eq(declarations.id, declarationVersions.declarationId))
        .leftJoin(commissionRefs, eq(commissionRefs.slug, declarationVersions.tenant))
        .where(eq(declarationVersions.id, versionId));
      // Only the slip set on the version is announced to the declarant.
      if (found?.version.ackDocumentId !== data.documentId) return;
      if (found.commissionName === null) {
        throw new Error(`No Commission reference for ${found.version.tenant}`);
      }
      const { version } = found;
      for (const channel of CHANNELS) {
        await this.notify(version, channel, {
          reference: version.reference,
          type: found.type,
          version: version.version,
          commissionName: found.commissionName,
          statementDate: found.statementDate,
          verificationCode: data.verificationId,
          portalUrl: portalUrlOf(version.declarationId),
        });
      }
    });
  }

  /**
   * `verification.checked.v1`: one more lookup of the slip with the code, whatever it answered.
   * Codes of no slip here (another document type, or unknown) change nothing.
   */
  async verified(event: EventEnvelope, data: VerificationCheckedData): Promise<void> {
    if (data.outcome === 'not-found') return;
    await consumeOnce(this.db, CHECKED_CONSUMER, event, async (tx) => {
      await switchTenant(tx, PLATFORM_CONTEXT);
      await tx
        .update(declarationVersions)
        .set({ verifiedCount: sql`${declarationVersions.verifiedCount} + 1` })
        .where(eq(declarationVersions.ackVerificationId, data.verificationId));
    });
  }

  /**
   * One channel of the acknowledgement. A message notifications could not send (no contact, the
   * provider refused) or refused outright is logged and not retried; notifications unreachable
   * throws, so the event is retried (the key keeps what was sent from going twice).
   */
  private async notify(
    version: VersionRow,
    channel: MessageChannel,
    params: Parameters<NotificationsClient['sendAcknowledgement']>[0]['params'],
  ): Promise<void> {
    try {
      const outcome = await this.notifications.sendAcknowledgement({
        channel,
        personId: version.personId,
        tenant: version.tenant,
        params,
        idempotencyKey: uuidv5(`${version.id}:${channel}`, ACKNOWLEDGEMENT_KEY_NAMESPACE),
      });
      if (outcome.status === 'failed') {
        this.logger.warn(
          { versionId: version.id, channel, reason: outcome.error },
          'Acknowledgement not sent',
        );
      }
    } catch (error) {
      if (error instanceof NotificationsRejected || error instanceof NotificationsKeyReused) {
        this.logger.error(
          { versionId: version.id, channel, err: errorType(error) },
          'Acknowledgement refused by notifications',
        );
        return;
      }
      throw error;
    }
  }
}

/** The portal page where the declarant downloads the slip, behind sign-in. */
function portalUrlOf(declarationId: string): string {
  return new URL(`/declarations/${declarationId}/submitted`, config.PORTAL_URL).toString();
}
