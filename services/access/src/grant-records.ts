import { and, eq } from 'drizzle-orm';

import type { AccessTransaction } from './db/database.js';
import type { PackageKind } from './decision.js';
import type { AccessRegister } from './register/access-register.js';
import { accessRegister } from './register/schema.js';

/**
 * The register entries of a grant's document, for a Form K request and a law enforcement request
 * alike (`AccessRequestWorkflow`, `LeaRequestWorkflow`): each request's activity reads and writes
 * its own table, then records the entry here in the same transaction.
 */

type GrantSubjectKind = 'access-request' | 'lea-request';

/** A request with a grant document, as its register entries need it. */
interface GrantRequest {
  id: string;
  tenant: string;
  reference: string;
  resolvedPersonId: string | null;
}

/** Records the `package-issued` entry and its event for the document just recorded. */
export async function recordPackageIssued(
  tx: AccessTransaction,
  register: AccessRegister,
  subjectKind: GrantSubjectKind,
  request: GrantRequest,
  issued: { id: string; issuedAt: Date; downloadExpiresAt: Date; kind: PackageKind },
): Promise<void> {
  const downloadExpiresAt = issued.downloadExpiresAt.toISOString();
  await register.record(tx, {
    tenant: request.tenant,
    subjectKind,
    subjectId: request.id,
    reference: request.reference,
    personId: request.resolvedPersonId,
    kind: 'package-issued',
    actor: null,
    at: issued.issuedAt,
    details: { documentId: issued.id, downloadExpiresAt, packageKind: issued.kind },
    eventData: { documentId: issued.id, downloadExpiresAt },
  });
}

/**
 * Records the `expired` entry, once, at the instant the download window closed, for a request
 * the caller holds locked (so two runs cannot both record it).
 */
export async function recordPackageExpired(
  tx: AccessTransaction,
  register: AccessRegister,
  subjectKind: GrantSubjectKind,
  request: GrantRequest & { packageDocumentId: string; downloadExpiresAt: Date },
): Promise<void> {
  const [expired] = await tx
    .select({ id: accessRegister.id })
    .from(accessRegister)
    .where(
      and(
        eq(accessRegister.subjectKind, subjectKind),
        eq(accessRegister.subjectId, request.id),
        eq(accessRegister.kind, 'expired'),
      ),
    );
  if (expired) return;
  await register.record(tx, {
    tenant: request.tenant,
    subjectKind,
    subjectId: request.id,
    reference: request.reference,
    personId: request.resolvedPersonId,
    kind: 'expired',
    actor: null,
    at: request.downloadExpiresAt,
    details: { documentId: request.packageDocumentId },
    eventData: { documentId: request.packageDocumentId },
  });
}
