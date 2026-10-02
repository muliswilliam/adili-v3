import type { Logger } from '@nestjs/common';

import { invariantBroken, rethrowAsActivityFailure } from './activity-failures.js';
import { type Clock, nairobiDate } from './clock.js';
import type { DeclarationsClient } from './declarations/declarations-client.js';
import type { DirectoryClient } from './directory/directory-client.js';
import type {
  AccessNilLetterPayload,
  AccessPackagePayload,
  DocumentsClient,
  IssuedDocument,
} from './documents/documents-client.js';
import type { PackageKind } from './decision.js';
import type { DisclosedClarification, ReviewClient } from './review/review-client.js';
import type { Scope } from './scope.js';
import { messageKey } from './requests/workflow-support.js';

/**
 * What a grant delivers (spec 10, decision 1), for a Form K request and a law enforcement
 * request alike: its access package when the declarant has declarations within the granted
 * scope, else a signed nil letter saying the Commission holds none. Both are Confidential,
 * watermarked with the recipient, the reference and the date, and downloadable by the
 * recipient for the Commission's download window. The calls run inside the one activity that
 * issues, so neither the disclosure nor a clarification enters workflow history.
 */

/** The template version of each document a grant delivers (documents' types). */
const TEMPLATE_VERSION = 1;

/** A decided grant, as `issueGrantDocument` needs it. */
export interface GrantToIssue {
  /** The Commission that decided. */
  tenant: string;
  requestId: string;
  /** `ARQ` or `LEA`. */
  reference: string;
  legalBasis: 'act-s36-1' | 'act-s36-2';
  /** The declarant's person; null when the officer has no account (served in writing). */
  personId: string | null;
  /** The declarant as the Commission identified them (the roster record resolved to). */
  declarantName: string;
  scope: Scope;
  /** Token subject of the access officer who decided, whom upstream reads are audited for. */
  decidedBy: string;
  grantedAt: string;
  /** The applicant or law enforcement officer: their token subject and person, as recipient. */
  recipientSubject: string;
  recipientPersonId: string;
  recipient: { name: string; organisation: string | null };
  /** As printed in the watermark (e.g. `Peter Mwangi, DCI`). */
  watermarkName: string;
  /** `access-request:<id>` or `lea-request:<id>`. */
  subjectRef: string;
}

export interface GrantDocumentDeps {
  declarations: DeclarationsClient;
  review: ReviewClient;
  documents: DocumentsClient;
  directory: DirectoryClient;
  clock: Clock;
  logger: Logger;
}

/**
 * The template that tells the recipient their grant's document is ready: a nil letter discloses
 * nothing, so it is not announced as a package (no s.36(4) warning about sharing what it discloses).
 * Null is a package issued before its kind was recorded (backfilled since, migration 0010).
 */
export function readyTemplate(
  kind: PackageKind | null,
): 'access-package-ready' | 'access-nil-letter-ready' {
  return kind === 'nil-letter' ? 'access-nil-letter-ready' : 'access-package-ready';
}

/** The document a grant delivered, and which. */
export interface GrantDocument {
  kind: PackageKind;
  issued: IssuedDocument & { downloadExpiresAt: Date };
}

/**
 * Issues the grant's document, once per kind (an idempotency key per request and kind):
 * declarations renders the disclosure of exactly the granted scope (audited there), review the
 * clarifications when the grant includes them, and documents issues the access package; when the
 * scope holds nothing (no declaration in it, or a declarant with no account and so none filed),
 * documents issues the nil letter instead. A refusal fails the activity without retrying; an
 * outage propagates, to be retried.
 */
export async function issueGrantDocument(
  deps: GrantDocumentDeps,
  grant: GrantToIssue,
): Promise<GrantDocument> {
  const { scope } = grant;
  const context = { requestId: grant.requestId };
  let disclosure = null;
  if (grant.personId !== null) {
    try {
      disclosure = await deps.declarations.renderDisclosure({
        personId: grant.personId,
        tenant: grant.tenant,
        officerSubject: grant.decidedBy,
        grantReference: grant.reference,
        legalBasis: grant.legalBasis,
        recipientSubject: grant.recipientSubject,
        years: scope.years,
        includeSpouses: scope.includeSpouses,
        includeChildren: scope.includeChildren,
        sections: scope.sections,
      });
    } catch (error) {
      rethrowAsActivityFailure(deps.logger, error, context, 'Disclosure refused by declarations');
    }
  }

  const shared = {
    tenant: grant.tenant,
    templateVersion: TEMPLATE_VERSION,
    subjectRef: grant.subjectRef,
    subjectPersonId: grant.recipientPersonId,
    watermark: {
      recipientName: grant.watermarkName,
      reference: grant.reference,
      date: nairobiDate(deps.clock.now()),
    },
    downloadWindowDays: (await deps.directory.accessPolicy(grant.tenant)).packageDownloadDays,
  };
  const grantedScope = {
    years: scope.years,
    includeSpouses: scope.includeSpouses,
    includeChildren: scope.includeChildren,
    sections: scope.sections,
    includeClarifications: scope.includeClarifications,
  };

  let kind: PackageKind;
  let issued: IssuedDocument;
  if (disclosure === null) {
    deps.logger.log(context, 'Nothing to disclose in the granted scope: issuing the nil letter');
    const commission = await deps.directory.findCommission(grant.tenant);
    if (commission === null)
      throw invariantBroken('The deciding Commission is not in the directory');
    const payload: AccessNilLetterPayload = {
      grantReference: grant.reference,
      commission: {
        slug: commission.slug,
        issuerCode: commission.issuerCode,
        name: commission.name,
      },
      declarantName: grant.declarantName,
      legalBasis: grant.legalBasis,
      recipient: grant.recipient,
      grantedAt: grant.grantedAt,
      scope: grantedScope,
    };
    kind = 'nil-letter';
    try {
      issued = await deps.documents.issue({
        ...shared,
        type: 'access-nil-letter',
        payload,
        idempotencyKey: messageKey(grant.requestId, 'access-nil-letter'),
      });
    } catch (error) {
      rethrowAsActivityFailure(deps.logger, error, context, 'Nil letter refused by documents');
    }
  } else {
    let clarifications: DisclosedClarification[] | null = null;
    if (scope.includeClarifications && grant.personId !== null) {
      try {
        clarifications = await deps.review.discloseClarifications({
          personId: grant.personId,
          tenant: grant.tenant,
          officerSubject: grant.decidedBy,
          grantReference: grant.reference,
          legalBasis: 'act-s36-1',
          recipientSubject: grant.recipientSubject,
          declarationReferences: disclosure.versions.map((version) => version.reference),
          includeSpouses: scope.includeSpouses,
          includeChildren: scope.includeChildren,
          sections: scope.sections,
        });
      } catch (error) {
        rethrowAsActivityFailure(deps.logger, error, context, 'Clarifications refused by review');
      }
    }
    const payload: AccessPackagePayload = {
      // Verbatim: declarations' cut of the granted scope, which documents validates strictly.
      disclosure: disclosure as unknown as AccessPackagePayload['disclosure'],
      legalBasis: grant.legalBasis,
      recipient: grant.recipient,
      grantedAt: grant.grantedAt,
      scope: grantedScope,
      clarifications,
    };
    kind = 'access-package';
    try {
      issued = await deps.documents.issue({
        ...shared,
        type: 'access-package',
        payload,
        idempotencyKey: messageKey(grant.requestId, PACKAGE_KEY[grant.legalBasis]),
      });
    } catch (error) {
      rethrowAsActivityFailure(deps.logger, error, context, 'Access package refused by documents');
    }
  }

  const { downloadExpiresAt } = issued;
  if (downloadExpiresAt === null) {
    throw invariantBroken('Documents issued the grant document without a download window');
  }
  return { kind, issued: { ...issued, downloadExpiresAt } };
}

/** Each kind of request's package idempotency key, as packages have always been issued with. */
const PACKAGE_KEY = {
  'act-s36-1': 'access-package',
  'act-s36-2': 'lea-package',
} as const;
