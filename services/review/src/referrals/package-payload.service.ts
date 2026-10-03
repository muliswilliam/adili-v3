import { Injectable } from '@nestjs/common';
import { notFoundIfInvisible } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import type { ReviewSchema } from '../db/schema.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
} from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { DocumentsClient, DocumentsUnavailable } from '../documents/documents-client.js';
import {
  declarationsUnavailable,
  upstreamUnavailable,
  withUpstream,
} from '../internal-api/upstream.js';
import { systemContext } from '../system-context.js';
import {
  clarificationContent,
  collectEvidence,
  EvidenceMissing,
  flagContent,
  planEvidence,
} from './evidence-package.js';
import { GROUNDS_LABELS, type ReferralPackagePayload } from './representation.js';
import { referrals } from './schema.js';

/**
 * The package payload the documents service pulls when it renders a referral's Confidential
 * evidence package (`internalGetReferralPackagePayload`), of an approved or sent referral whose
 * manifest is built. The evidence is pulled again as the manifest was (versions are immutable, so
 * their hashes match); nothing of it is stored here.
 */
@Injectable()
export class ReferralPackagePayloadService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
  ) {}

  async payload(tenant: string, referralId: string): Promise<ReferralPackagePayload> {
    const { referral, plan } = await withTenant(this.db, systemContext(tenant), async (tx) => {
      const [found] = await tx
        .select()
        .from(referrals)
        .where(
          and(
            eq(referrals.id, referralId),
            inArray(referrals.status, ['approved', 'sent']),
            isNotNull(referrals.packageManifest),
          ),
        );
      const visible = notFoundIfInvisible(found);
      return { referral: visible, plan: await planEvidence(tx, visible) };
    });
    const { reference, approvedAt, approver, packageManifest } = referral;
    if (reference === null || approvedAt === null || approver === null || !packageManifest) {
      throw new Error(`Referral ${referralId} is approved without a reference`);
    }
    const commission = await withUpstream(() => this.directory.getCommission(tenant));
    let evidence;
    try {
      evidence = await collectEvidence(
        { declarations: this.declarations, documents: this.documents },
        referral,
        plan,
      );
    } catch (error) {
      if (error instanceof DeclarationsUnavailable || error instanceof EvidenceMissing) {
        throw declarationsUnavailable('The evidence could not be read. Try again shortly.');
      }
      if (error instanceof DocumentsUnavailable) {
        throw upstreamUnavailable('documents', 'The letters could not be read. Try again shortly.');
      }
      throw error;
    }
    return {
      declarantPersonId: referral.personId,
      reference,
      grounds: referral.grounds,
      groundsLabel: GROUNDS_LABELS[referral.grounds],
      cycleYear: referral.cycleYear,
      commission: { name: commission.name, issuerCode: commission.issuerCode },
      declarant: {
        name: referral.declarantName,
        personnelFileNumber: referral.personnelFileNumber,
      },
      narrative: referral.narrative,
      proposedBy:
        referral.proposerKind === 'system'
          ? 'Adili (system proposal)'
          : (referral.proposerName ?? referral.proposer ?? 'unknown'),
      proposedAt: referral.proposedAt.toISOString(),
      approvedBy: referral.approverName ?? approver,
      approvedAt: approvedAt.toISOString(),
      manifest: packageManifest,
      versions: evidence.versions.map((version) => ({
        reference: version.reference,
        version: version.version,
        type: version.type,
        statementDate: version.statementDate,
        submittedAt: version.submittedAt,
        late: version.late,
        document: version.document,
      })),
      flags: plan.flags.map((flag) => ({
        caseReference: flag.caseReference,
        ...flagContent(flag),
      })),
      clarifications: plan.clarifications.map(({ clarification, response }) =>
        clarificationContent(clarification, response),
      ),
      obligations: evidence.obligations.map(({ cycleKey, type, status, dueDate, filedAt }) => ({
        cycleKey,
        type,
        status,
        dueDate,
        filedAt,
      })),
      letters: plan.letters.map(({ reference: letterReference, documentId }) => ({
        reference: letterReference,
        documentId,
      })),
    };
  }
}
