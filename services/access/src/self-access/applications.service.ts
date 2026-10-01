import { Inject, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, FieldCipherError, withTenant } from '@adili/data-access';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { commissionTenant, ownCommissionTenant, requireAccessOfficer } from '../access.js';
import { addDays, Clock } from '../clock.js';
import { config } from '../config.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import {
  DeclarationsClient,
  DeclarationsUnavailable,
  type PersonVersion,
} from '../declarations/declarations-client.js';
import {
  type CommissionFacts,
  DirectoryClient,
  DirectoryUnavailable,
  type RosterRecordFacts,
} from '../directory/directory-client.js';
import {
  ACCESS_REPRESENTATION_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { decodeCursor, encodeCursor } from '../paging.js';
import {
  badRequest,
  conflict,
  declarationsUnavailable,
  directoryUnavailable,
  documentsUnavailable,
  keyServiceUnavailable,
  notFound,
  type ProblemError,
} from '../problems.js';
import type { RosterCandidates } from '../requests/officer-representation.js';
import {
  type DeclarantVersions,
  type SelfAccessApplicationDetail,
  type SelfAccessApplicationInput,
  type SelfAccessApplicationRow,
  type SelfAccessListQuery,
  type SelfAccessPage,
  toDeclarantVersion,
  toSelfAccessApplication,
  toSelfAccessApplicationDetail,
} from './application-representation.js';
import { CertifiedCopyIssuance, type CertifiedCopyRow } from './certified-copy-issuance.js';
import {
  certifiedCopies,
  type SelfAccessRepresentative,
  selfAccessApplications,
} from './schema.js';

/** The record id bound into an application's encrypted representative ID number (AAD). */
export function selfAccessRecordId(applicationId: string): string {
  return `self-access:${applicationId}`;
}

/**
 * Written self-access applications the Commission's access officer records (spec 10,
 * Administrative Mechanism 32): a declarant who cannot use the portal, or their representative,
 * applies in writing for a certified copy of a submitted version. The officer finds the
 * declarant on the roster, checks the applicant's identity (and a representative's written
 * authority and ID, as uploads), and records it; the certified copy is ordered at once through
 * `CertifiedCopyIssuance` (as the declarant's portal request is), due 14 days from receipt, and
 * registered `self-access` naming the representative when issued. The officer then marks it
 * collected or dispatched. The access officer acts; the supervisor reads (403 on acting); anyone
 * else, another Commission or EACC, gets 404.
 */
@Injectable()
export class SelfAccessApplicationsService {
  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly directory: DirectoryClient,
    private readonly declarations: DeclarationsClient,
    private readonly documents: DocumentsClient,
    private readonly cipher: FieldCipher,
    private readonly issuance: CertifiedCopyIssuance,
    private readonly clock: Clock,
  ) {}

  /** The Commission's roster records matching a search, as the officer looks for the declarant. */
  async declarants(principal: Principal, slug: string, search: string): Promise<RosterCandidates> {
    const tenant = commissionTenant(principal, slug);
    requireAccessOfficer(principal, 'record a self-access application');
    const found = await this.fromDirectory(() => this.directory.searchRoster(tenant, search));
    return {
      items: found.map((record) => ({
        id: record.id,
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        designation: record.designation,
        reportingEntity: record.reportingEntityName,
        state: record.state,
        onboarded: record.personId !== null,
      })),
    };
  }

  /**
   * The submitted versions of the roster record's declarant at the Commission, latest first:
   * what the copy can be of. A record the Commission does not have is 404; one not onboarded has
   * none.
   */
  async declarantVersions(
    principal: Principal,
    slug: string,
    rosterRecordId: string,
  ): Promise<DeclarantVersions> {
    const tenant = commissionTenant(principal, slug);
    requireAccessOfficer(principal, 'record a self-access application');
    const record = await this.fromDirectory(() =>
      this.directory.rosterRecord(tenant, rosterRecordId),
    );
    if (record === null) throw notFound('No such roster record of the Commission.');
    const versions = record.personId === null ? [] : await this.versionsOf(tenant, record.personId);
    return {
      declarant: {
        rosterRecordId: record.id,
        personnelFileNumber: record.personnelFileNumber,
        fullName: record.fullName,
        onboarded: record.personId !== null,
      },
      versions: versions.map(toDeclarantVersion),
    };
  }

  /**
   * Records a written application and orders its certified copy (Restricted, the declarant its
   * subject), due `SELF_ACCESS_DAYS` from now. The roster record must be an onboarded one of the
   * Commission and the version one the declarant submitted there (400 at `rosterRecordId` /
   * `version` otherwise); a representative's authority and ID must be clean uploads of purpose
   * `access-representation` the officer made (400 at the upload otherwise), linked in documents
   * before the save. Their ID number is stored encrypted. The directory, declarations, documents,
   * the key service or the workflow engine unreachable is 503, with nothing recorded.
   */
  async record(
    principal: Principal,
    slug: string,
    input: SelfAccessApplicationInput,
  ): Promise<SelfAccessApplicationDetail> {
    const tenant = commissionTenant(principal, slug);
    requireAccessOfficer(principal, 'record a self-access application');

    const commission = await this.commission(tenant);
    const record = await this.onboardedRecord(tenant, input.rosterRecordId);
    const version = await this.submittedVersion(tenant, record.personId, input);
    const representative =
      input.representative === null
        ? null
        : await this.representative(principal, tenant, input.representative);

    const id = uuidv7();
    const sealed =
      input.representative === null
        ? null
        : await this.seal(tenant, id, input.representative.idNumber);
    if (representative !== null) {
      await this.link(tenant, [representative.authorityUploadId, representative.idUploadId]);
    }

    const now = this.clock.now();
    const { row, copy } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const [row] = await tx
          .insert(selfAccessApplications)
          .values({
            id,
            tenant,
            personId: record.personId,
            rosterRecordId: record.id,
            declarantName: record.fullName,
            personnelFileNumber: record.personnelFileNumber,
            declarationId: version.declarationId,
            version: version.version,
            declarationReference: version.reference,
            identityNote: input.identityNote,
            representative,
            representativeIdCiphertext: sealed?.ciphertext ?? null,
            representativeIdEnvelope: sealed?.envelope ?? null,
            status: 'recorded',
            deliveryMethod: input.deliveryMethod,
            deadlineAt: addDays(now, config.SELF_ACCESS_DAYS),
            recordedBy: principal.subject,
            recordedByName: principal.name ?? principal.subject,
            receivedAt: now,
          })
          .returning();
        if (!row) throw new Error('The self-access application was not recorded');
        // The workflow starts last: Temporal unreachable rolls the application back (503).
        const copy = await this.issuance.order(tx, {
          tenant,
          commissionName: commission.name,
          personId: record.personId,
          declarationId: version.declarationId,
          version: version.version,
          requestedBy: { subject: principal.subject, name: principal.name },
          applicationId: id,
          at: now,
        });
        return { row, copy };
      },
    );
    return toSelfAccessApplicationDetail(
      row,
      copy,
      input.representative?.idNumber ?? null,
      this.clock.now(),
    );
  }

  /**
   * One page of the Commission's applications, earliest deadline first (then by id), each with
   * its certified copy and whether it is late.
   */
  async list(
    principal: Principal,
    slug: string,
    query: SelfAccessListQuery,
  ): Promise<SelfAccessPage> {
    const tenant = commissionTenant(principal, slug);
    const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const { rows, copies } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const rows = await tx
          .select()
          .from(selfAccessApplications)
          .where(
            and(
              eq(selfAccessApplications.tenant, tenant),
              query.status === undefined
                ? undefined
                : eq(selfAccessApplications.status, query.status),
              after === undefined
                ? undefined
                : sql`(${selfAccessApplications.deadlineAt}, ${selfAccessApplications.id}) > (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)`,
            ),
          )
          .orderBy(asc(selfAccessApplications.deadlineAt), asc(selfAccessApplications.id))
          .limit(query.limit + 1);
        return { rows, copies: await copiesOf(tx, rows) };
      },
    );
    const now = this.clock.now();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => toSelfAccessApplication(row, copyFor(copies, row), now)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor({ at: last.deadlineAt, id: last.id })
          : null,
    };
  }

  /** One application of the caller's Commission, with the representative's ID number. */
  async get(principal: Principal, applicationId: string): Promise<SelfAccessApplicationDetail> {
    const tenant = ownCommissionTenant(principal);
    const found = notFoundIfInvisible(
      await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
        applicationWithCopy(tx, applicationId),
      ),
    );
    return this.detail(found.row, found.copy);
  }

  /**
   * The access officer marks the issued copy collected or dispatched (as the application was
   * marked): the application is `delivered`. Before the copy is issued, or once delivered, 409.
   */
  async markDelivered(
    principal: Principal,
    applicationId: string,
  ): Promise<SelfAccessApplicationDetail> {
    const tenant = ownCommissionTenant(principal);
    requireAccessOfficer(principal, 'mark a certified copy collected or dispatched');
    const { row, copy } = await withTenant(
      this.db,
      { tenant, subject: principal.subject },
      async (tx) => {
        const current = notFoundIfInvisible(
          await applicationWithCopy(tx, applicationId, { lock: true }),
        );
        if (current.row.status === 'delivered') {
          throw conflict(
            `The certified copy is marked ${current.row.deliveryMethod === 'collection' ? 'collected' : 'dispatched'} already.`,
          );
        }
        if (current.row.status !== 'issued') {
          throw conflict('The certified copy is not issued yet.');
        }
        const [updated] = await tx
          .update(selfAccessApplications)
          .set({
            status: 'delivered',
            deliveredAt: this.clock.now(),
            deliveredBy: principal.subject,
          })
          .where(eq(selfAccessApplications.id, current.row.id))
          .returning();
        if (!updated) throw new Error('The self-access application was not updated');
        return { row: updated, copy: current.copy };
      },
    );
    return this.detail(row, copy);
  }

  private async detail(
    row: SelfAccessApplicationRow,
    copy: CertifiedCopyRow,
  ): Promise<SelfAccessApplicationDetail> {
    return toSelfAccessApplicationDetail(row, copy, await this.open(row), this.clock.now());
  }

  private async commission(tenant: string): Promise<CommissionFacts> {
    const commission = await this.fromDirectory(() => this.directory.findCommission(tenant));
    if (commission === null) throw notFound();
    return commission;
  }

  /** The roster record `recordId` of the Commission, onboarded; 400 otherwise. */
  private async onboardedRecord(
    tenant: string,
    recordId: string,
  ): Promise<RosterRecordFacts & { personId: string }> {
    const record = await this.fromDirectory(() => this.directory.rosterRecord(tenant, recordId));
    if (record === null) {
      throw badRequest('No such roster record of the Commission.', [
        { path: 'rosterRecordId', message: 'is not a roster record of the Commission' },
      ]);
    }
    const { personId } = record;
    if (personId === null) {
      throw badRequest('The officer has not onboarded, so they have no declarations to copy.', [
        { path: 'rosterRecordId', message: 'has not onboarded: the officer has no declarations' },
      ]);
    }
    return { ...record, personId };
  }

  /** The version the application asks for, among the declarant's submitted ones; 400 otherwise. */
  private async submittedVersion(
    tenant: string,
    personId: string,
    input: Pick<SelfAccessApplicationInput, 'declarationId' | 'version'>,
  ): Promise<PersonVersion> {
    const versions = await this.versionsOf(tenant, personId);
    const found = versions.find(
      (version) =>
        version.declarationId === input.declarationId && version.version === input.version,
    );
    if (found) return found;
    throw badRequest('No such submitted version of the declarant at the Commission.', [
      { path: 'version', message: 'is not a submitted version of the declarant' },
    ]);
  }

  private async versionsOf(tenant: string, personId: string): Promise<PersonVersion[]> {
    try {
      return await this.declarations.personVersions(tenant, personId);
    } catch (error) {
      if (error instanceof DeclarationsUnavailable) throw declarationsUnavailable();
      throw error;
    }
  }

  /**
   * The representative, with their proofs checked: clean uploads of purpose
   * `access-representation` the officer made.
   */
  private async representative(
    principal: Principal,
    tenant: string,
    input: NonNullable<SelfAccessApplicationInput['representative']>,
  ): Promise<SelfAccessRepresentative> {
    const errors: ProblemError[] = [];
    const fileName = async (field: 'authorityUploadId' | 'idUploadId'): Promise<string> => {
      const path = `representative.${field}`;
      try {
        const upload = await this.documents.getCleanUpload(tenant, input[field]);
        if (upload.purpose !== ACCESS_REPRESENTATION_PURPOSE) {
          errors.push({ path, message: `is not an upload for ${ACCESS_REPRESENTATION_PURPOSE}` });
        } else if (upload.uploadedBy !== principal.subject) {
          errors.push({ path, message: 'is not an upload of yours' });
        }
        return upload.fileName ?? 'upload';
      } catch (error) {
        if (error instanceof UploadNotFound) {
          errors.push({ path, message: 'is not an upload of yours' });
        } else if (error instanceof UploadNotClean) {
          errors.push({ path, message: 'is not clean: still being scanned, or refused' });
        } else if (error instanceof DocumentsUnavailable) {
          throw documentsUnavailable();
        } else {
          throw error;
        }
        return '';
      }
    };
    const authorityFileName = await fileName('authorityUploadId');
    const idFileName = await fileName('idUploadId');
    if (errors.length > 0) throw badRequest("The representative's uploads cannot be used.", errors);
    return {
      name: input.name,
      authorityUploadId: input.authorityUploadId,
      idUploadId: input.idUploadId,
      authorityFileName,
      idFileName,
    };
  }

  /** Keeps the uploads from documents' orphan sweep; before the save, so none is lost after it. */
  private async link(tenant: string, uploadIds: readonly string[]): Promise<void> {
    try {
      for (const uploadId of uploadIds) await this.documents.markLinked(tenant, uploadId);
    } catch (error) {
      if (error instanceof DocumentsUnavailable) throw documentsUnavailable();
      throw error;
    }
  }

  /** Encrypts the representative's ID number under the Commission's key; 503 when it is down. */
  private async seal(
    tenant: string,
    applicationId: string,
    idNumber: string,
  ): Promise<{
    ciphertext: string;
    envelope: SelfAccessApplicationRow['representativeIdEnvelope'];
  }> {
    try {
      return await this.cipher.encrypt({
        tenant,
        recordId: selfAccessRecordId(applicationId),
        plaintext: idNumber,
      });
    } catch (error) {
      if (error instanceof FieldCipherError && error.code === 'unavailable') {
        throw keyServiceUnavailable();
      }
      throw error;
    }
  }

  /** The representative's ID number, decrypted; null when the declarant applied. */
  private async open(row: SelfAccessApplicationRow): Promise<string | null> {
    const { representativeIdCiphertext: ciphertext, representativeIdEnvelope: envelope } = row;
    if (ciphertext === null || envelope === null) return null;
    try {
      const plaintext = await this.cipher.decrypt({
        tenant: row.tenant,
        recordId: selfAccessRecordId(row.id),
        ciphertext,
        envelope,
      });
      return plaintext.toString('utf8');
    } catch (error) {
      if (error instanceof FieldCipherError && error.code === 'unavailable') {
        throw keyServiceUnavailable();
      }
      throw error;
    }
  }

  private async fromDirectory<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof DirectoryUnavailable) throw directoryUnavailable();
      throw error;
    }
  }
}

/** The certified copies of the applications, by application id. */
async function copiesOf(
  tx: AccessTransaction,
  rows: readonly SelfAccessApplicationRow[],
): Promise<Map<string, CertifiedCopyRow>> {
  if (rows.length === 0) return new Map();
  const found = await tx
    .select()
    .from(certifiedCopies)
    .where(
      inArray(
        certifiedCopies.applicationId,
        rows.map((row) => row.id),
      ),
    );
  return new Map(found.flatMap((copy) => (copy.applicationId ? [[copy.applicationId, copy]] : [])));
}

function copyFor(
  copies: ReadonlyMap<string, CertifiedCopyRow>,
  row: SelfAccessApplicationRow,
): CertifiedCopyRow {
  const copy = copies.get(row.id);
  if (!copy) throw new Error('A self-access application without its certified copy');
  return copy;
}

async function applicationWithCopy(
  tx: AccessTransaction,
  applicationId: string,
  { lock = false }: { lock?: boolean } = {},
): Promise<{ row: SelfAccessApplicationRow; copy: CertifiedCopyRow } | null> {
  const query = tx
    .select()
    .from(selfAccessApplications)
    .where(eq(selfAccessApplications.id, applicationId));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) return null;
  return { row, copy: copyFor(await copiesOf(tx, [row]), row) };
}
