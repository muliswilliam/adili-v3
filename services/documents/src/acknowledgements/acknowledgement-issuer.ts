import { Injectable, Logger } from '@nestjs/common';
import { errorType, ProblemException, TENANT_KEY } from '@adili/api-kit';
import { type Database, InjectDatabase } from '@adili/data-access';
import { consumeIdempotent, type EventEnvelope } from '@adili/events';
import { ACKNOWLEDGEMENT_SLIP } from '@adili/events/contracts';

import { SYSTEM_SUBJECT } from '../config.js';
import type { DocumentsSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { IssuanceService } from '../issuance/issuance.service.js';

/** The slip's template (ADR-010 registry). */
const TEMPLATE_VERSION = 1;

/** What an event asking for a version's slip says about it (identifiers only). */
export interface SlipRequest {
  declarationId: string;
  versionId: string;
  version: number;
  reference: string;
}

/**
 * Issues a declaration version's acknowledgement slip when declarations asks for it (spec 06):
 * pulls the payload by version (ADR-013: the event carries identifiers), issues through
 * `IssuanceService` for the declarant, and supersedes the declaration's earlier slips by the
 * newest (an amendment's slip replaces the one before, whichever was issued first). An event is
 * handled once (`consumeIdempotent`: recorded after the work, as issuing is idempotent per
 * version, so no transaction is held across rendering, signing and the calls out); a slip
 * issued already is announced again, for a declarations service that missed it. A dependency
 * down (Gotenberg, OpenBao, storage, declarations) throws: the transport retries once, then
 * dead-letters, and declarations' reissue asks again later.
 */
@Injectable()
export class AcknowledgementIssuer {
  private readonly logger = new Logger(AcknowledgementIssuer.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DocumentsSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly issuance: IssuanceService,
  ) {}

  async issue(consumer: string, event: EventEnvelope, request: SlipRequest): Promise<void> {
    await consumeIdempotent(this.db, consumer, event, () => this.issueSlip(event, request));
  }

  private async issueSlip(event: EventEnvelope, request: SlipRequest): Promise<void> {
    const tenant = event.tenant;
    if (!tenant || !TENANT_KEY.test(tenant)) throw new Error(`Event ${event.id} has no tenant`);

    const payload = await this.declarations.acknowledgementPayload(
      tenant,
      request.declarationId,
      request.version,
    );
    const { document, created } = await this.issuance.issue({
      tenant,
      actor: SYSTEM_SUBJECT,
      type: ACKNOWLEDGEMENT_SLIP,
      templateVersion: TEMPLATE_VERSION,
      subjectRef: `declaration-version:${request.versionId}`,
      subjectPersonId: payload.declarantPersonId,
      payload: payload.slip,
    });
    if (!created) await this.issuance.announce(tenant, SYSTEM_SUBJECT, document.id);
    await this.supersedeEarlier(tenant, request.reference);
  }

  /**
   * Leaves one valid slip of the declaration, the newest version's: every other one is marked
   * superseded by it. A slip superseded meanwhile (a concurrent consumer) is left as it is.
   */
  private async supersedeEarlier(tenant: string, reference: string): Promise<void> {
    const valid = await this.issuance.validOfReference(tenant, ACKNOWLEDGEMENT_SLIP, reference);
    const newest = valid.reduce<(typeof valid)[number] | undefined>(
      (best, slip) => (best && (best.version ?? 0) >= (slip.version ?? 0) ? best : slip),
      undefined,
    );
    if (!newest) return;
    for (const slip of valid) {
      if (slip.documentId === newest.documentId) continue;
      try {
        await this.issuance.supersede({
          tenant,
          actor: SYSTEM_SUBJECT,
          documentId: slip.documentId,
          supersededBy: newest.documentId,
        });
      } catch (error) {
        if (!(error instanceof ProblemException && error.problem.status === 409)) throw error;
        this.logger.warn(
          { documentId: slip.documentId, err: errorType(error) },
          'Slip changed while being superseded',
        );
      }
    }
  }
}
