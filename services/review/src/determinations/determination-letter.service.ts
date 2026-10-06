import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { ApplicationFailure } from '@temporalio/common';
import { and, eq } from 'drizzle-orm';

import { reviewTenant } from '../cases/access.js';
import { visibleId } from '../cases/case-lookup.js';
import { asPerson } from '../clarifications/declarant-clarifications.service.js';
import { letterDownloadUrl } from '../clarifications/links.js';
import type { ReviewSchema } from '../db/schema.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { upstreamUnavailable, withUpstream } from '../internal-api/upstream.js';
import { DECISION_LETTER_REFUSED } from './contract.js';
import { issueDecisionLetter } from './decision-letter.js';
import type { LetterDownloadView } from './representation.js';
import { determinations } from './schema.js';

/** A decision letter as served, with whom a staff read of it is about (null for the declarant). */
export interface ServedLetter {
  letter: LetterDownloadView;
  /** The Commission and declarant a staff read names in its audit (ADR-008); null for the owner. */
  readOf: { tenant: string; personId: string } | null;
}

/**
 * A determination's decision letter (`getDeterminationLetter`, spec 08). An individual
 * determination's letter is issued at approval; a bulk closure's is issued the first time anyone
 * asks for it, then served like any other. The Commission's reviewers and supervisors read their
 * own Commission's; the declarant reads their own approved ones (the owner rule); anyone else 404.
 *
 * Documents' public download serves only the person a document is about, so staff get their link
 * here: documents hands it out for the Commission (`internalGetDocumentDownload`, one hop,
 * ADR-013), naming the staff member it is read for, as for clarification letters (#507).
 */
@Injectable()
export class DeterminationLetterService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly documents: DocumentsClient,
  ) {}

  /** The letter for `principal`: staff of the Commission, or the declarant `personId`. */
  async letter(
    principal: Principal,
    personId: string | null,
    determinationId: string,
  ): Promise<ServedLetter> {
    const id = visibleId(determinationId);
    const tenant = reviewTenant(principal);
    if (tenant !== null) {
      const found = await withTenant(
        this.db,
        { tenant, subject: principal.subject },
        async (tx) => {
          const [row] = await tx
            .select({ status: determinations.status, personId: determinations.personId })
            .from(determinations)
            .where(and(eq(determinations.id, id), eq(determinations.tenant, tenant)));
          return row;
        },
      );
      const { status, personId: declarant } = notFoundIfInvisible(found);
      if (status !== 'approved') throw notApproved(status);
      const letter = await this.issue(tenant, id);
      const download = await withUpstream(() =>
        this.documents.getIssuedDocumentDownload(letter.documentId, tenant, principal.subject),
      );
      return {
        letter: { ...letter, downloadUrl: notFoundIfInvisible(download).downloadUrl },
        readOf: { tenant, personId: declarant },
      };
    }
    const person = notFoundIfInvisible(personId);
    // Only approved determinations of the person are visible under `app.person`.
    const owned = await this.db.transaction(async (tx) => {
      await asPerson(tx, person);
      const [row] = await tx
        .select({ tenant: determinations.tenant })
        .from(determinations)
        .where(and(eq(determinations.id, id), eq(determinations.personId, person)));
      return row;
    });
    const letter = await this.issue(notFoundIfInvisible(owned).tenant, id);
    return {
      letter: { ...letter, downloadUrl: letterDownloadUrl(letter.documentId) },
      readOf: null,
    };
  }

  /** The approved determination's letter, issued now if it has none. */
  private async issue(
    tenant: string,
    determinationId: string,
  ): Promise<{ documentId: string; verificationId: string }> {
    let letter;
    try {
      letter = await withUpstream(() =>
        issueDecisionLetter({ db: this.db, documents: this.documents }, tenant, determinationId),
      );
    } catch (error) {
      if (error instanceof ApplicationFailure && error.type === DECISION_LETTER_REFUSED) {
        throw upstreamUnavailable('documents', 'The documents service refused the letter.');
      }
      throw error;
    }
    if (letter.status === 'missing') throw notFound();
    if (letter.status === 'not-approved') throw notApproved();
    return { documentId: letter.documentId, verificationId: letter.verificationId };
  }
}

function notFound(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'The resource does not exist or is not visible to you.',
  });
}

function notApproved(status?: string): ProblemException {
  return new ProblemException(
    {
      type: 'not-approved',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: 'The determination is not approved, so it has no decision letter.',
    },
    { code: 'not-approved', ...(status ? { determinationStatus: status } : {}) },
  );
}
