import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { errorType, notFoundIfInvisible, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withPerson, withTenant } from '@adili/data-access';
import { EventPublisher, type NewEvent } from '@adili/events';
import {
  CLARIFICATION_LETTER,
  DOCUMENT_DOWNLOADED,
  DOCUMENT_ISSUED,
  DOCUMENT_REVOKED,
  DOCUMENT_SUPERSEDED,
  type DocumentDownloadedData,
  type DocumentEventData,
  type DocumentIssuedData,
  type DocumentRevokedData,
  type DocumentSupersededData,
  type DocumentType,
  newVerificationId,
  type RevocationReason,
} from '@adili/events/contracts';
import { ACCESS_OFFICER } from '@adili/roles';
import { and, arrayContains, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

import { Clock } from '../clock.js';
import { config, SYSTEM_SUBJECT } from '../config.js';
import type { DocumentsSchema } from '../db/schema.js';
import { ClarificationNotFound, ReviewClient, ReviewUnavailable } from '../review/review-client.js';
import { S3, S3_PUBLIC } from '../storage/storage.module.js';
import { dependencyProblem, IssuanceDependencyUnavailable } from './errors.js';
import { PadesSigner } from './pades.js';
import { RecordSigner, type SignedRecord } from './record-signer.js';
import { PdfRenderer } from './renderer.js';
import {
  clarificationLetterSource,
  type DocumentDownload,
  type IssuedDocument,
} from './representation.js';
import { issuedDocuments, verificationRecords } from './schema.js';
import { footerDocument, type Watermark, watermarked } from './templates/page.js';
import { templateOf } from './templates/registry.js';
import type { DocumentTemplate } from './templates/template.js';

/** Injection token of the verify app's origin (`VERIFY_BASE_URL`). */
export const VERIFY_BASE_URL = Symbol('VERIFY_BASE_URL');

/** Lifespan of the presigned GET handed to the owner, or to a service for its staff. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The saved file's name: the document type and its reference, e.g. `certified-copy-DCI-PSC-2026-0000001-Y.pdf`. */
export function downloadFileName(document: {
  type: string;
  reference: string | null;
  id: string;
}): string {
  return `${document.type}-${document.reference ?? document.id}.pdf`.replace(
    /[^A-Za-z0-9.-]/g,
    '-',
  );
}

type DocumentRow = typeof issuedDocuments.$inferSelect;
type RecordRow = typeof verificationRecords.$inferSelect;
type Tx = Parameters<Parameters<Database<DocumentsSchema>['transaction']>[0]>[0];
interface DocumentWithRecord {
  document: DocumentRow;
  record: RecordRow;
}
/**
 * Who the review service says the letter is for, beside the fields the template renders: the
 * issue request's `subjectPersonId` must be this person.
 */
const letterSubject = z.looseObject({ declarantPersonId: z.uuid() });

/** The subject of the letter of a clarification: one letter per clarification. */
function clarificationSubjectRef(clarificationId: string): string {
  return `clarification:${clarificationId}`;
}

/** Tries at a status change whose records keep changing between signing and writing. */
const MAX_STATUS_CHANGE_ATTEMPTS = 3;

/**
 * A request to issue a document for a tenant (the issuing Commission): the fields the template
 * renders, or for a letter of the review service the record they are pulled for.
 */
export interface IssueRequest {
  tenant: string;
  /** `sub` of the service or user asking, recorded on the document. */
  actor: string;
  type: DocumentType;
  templateVersion: number;
  subjectRef: string;
  subjectPersonId: string | null;
  /** Printed across every page: who the document is issued to, for what and when. */
  watermark?: Watermark;
  /** Days from issue the subject person may download it; none for no window. */
  downloadWindowDays?: number;
  /** Subjects of the issuing Commission's staff who may download it too. */
  additionalDownloaders?: string[];
  /** The fields the template renders, or for a clarification letter its `clarificationId`. */
  payload: unknown;
}

/** Who asks for a document or its download, from their token. */
export interface Downloader {
  /** The token's `person_id`: the subject person of the documents about them. */
  personId: string | null;
  subject: string;
  /** The token's tenant: staff may download what their Commission named them on. */
  tenant: string | null;
  /** The token's roles: an additional downloader must still be an access officer. */
  roles: readonly string[];
}

export interface IssueOutcome {
  document: IssuedDocument;
  /** False when a document of the type was issued for the subject already (and is returned). */
  created: boolean;
}

export interface SupersedeRequest {
  tenant: string;
  actor: string;
  documentId: string;
  supersededBy: string;
}

export interface RevokeRequest {
  tenant: string;
  actor: string;
  documentId: string;
  reason: RevocationReason;
}

/**
 * The issuance pipeline (ADR-010): render the versioned template to PDF with the verification
 * footer on every page, PAdES-sign it, hash it, sign the verification record, store the PDF and
 * register it with its event in one transaction. A dependency that fails before the commit
 * leaves nothing registered (502 to HTTP callers). Also supersession and the owner's download.
 */
@Injectable()
export class IssuanceService {
  private readonly logger = new Logger(IssuanceService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DocumentsSchema>,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(S3_PUBLIC) private readonly publicS3: S3Client,
    private readonly renderer: PdfRenderer,
    private readonly pades: PadesSigner,
    private readonly records: RecordSigner,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
    private readonly review: ReviewClient,
    @Inject(VERIFY_BASE_URL) private readonly verifyBaseUrl: string,
  ) {}

  /**
   * Issues a document, or returns the one of the same type already issued for the subject (for a
   * clarification letter, before its fields are pulled). Throws 400 for an unknown template, a
   * payload the template refuses, a request without what the template requires (a watermark, a
   * download window, a subject person) or a clarification the review service does not hold; 502
   * when the renderer, the signer, storage or the review service fails.
   */
  async issue(request: IssueRequest): Promise<IssueOutcome> {
    const template = templateOf(request.type, request.templateVersion);
    if (!template) {
      throw validationProblem([
        {
          path: 'templateVersion',
          message: `No template ${request.type} v${request.templateVersion}`,
        },
      ]);
    }
    // A clarification letter names its clarification; the fields it renders are pulled below.
    const letter =
      request.type === CLARIFICATION_LETTER
        ? clarificationLetterSource.safeParse(request.payload)
        : null;
    const source = letter ?? template.payload.safeParse(request.payload);
    const missing = missingRequirements(template, request);
    if (!source.success || missing.length > 0) {
      throw validationProblem([
        ...missing,
        ...(source.error?.issues ?? []).map((issue) => ({
          path: ['payload', ...issue.path].join('.'),
          message: issue.message,
        })),
      ]);
    }
    const clarificationId = letter?.data?.clarificationId ?? null;
    if (
      clarificationId !== null &&
      request.subjectRef !== clarificationSubjectRef(clarificationId)
    ) {
      throw validationProblem([
        {
          path: 'subjectRef',
          message: `A clarification letter's subject is ${clarificationSubjectRef(clarificationId)}`,
        },
      ]);
    }
    const existing = await this.findBySubject(request.tenant, request.type, request.subjectRef);
    if (existing) return { document: existing, created: false };

    const fields = await this.fieldsOf(request, clarificationId);
    const parsed = template.payload.safeParse(fields.payload);
    if (!parsed.success) {
      throw validationProblem([
        ...parsed.error.issues.map((issue) => ({
          path: fields.pulled ? 'payload' : ['payload', ...issue.path].join('.'),
          message: fields.pulled
            ? `The pulled ${[...issue.path].join('.') || 'payload'} is not the template's: ${issue.message}`
            : issue.message,
        })),
      ]);
    }
    const payload = parsed.data;
    const documentId = uuidv7();
    const verificationId = newVerificationId();
    const issuedAt = this.clock.now();
    const downloadExpiresAt =
      request.downloadWindowDays === undefined
        ? null
        : new Date(issuedAt.getTime() + request.downloadWindowDays * DAY_MS);
    // Spec 06: the issued bucket keeps every document at `issued/<documentId>.pdf`.
    const objectKey = `issued/${documentId}.pdf`;
    const verifyUrl = this.verifyUrlOf(verificationId);
    const publicPayload = template.publicPayload(payload, { issuedAt });

    let stored = false;
    try {
      const certificates = await this.pades.signingCertificates();
      const rendered = template.render(payload, {
        verificationId,
        issuedAt,
        signerName: certificates.signerName,
      });
      const html = request.watermark ? watermarked(rendered, request.watermark) : rendered;
      const footer = await footerDocument({
        ...template.footer(payload),
        verificationId,
        verifyUrl,
        issuedAt,
      });
      const pdf = await this.pades.sign(await this.renderer.render(html, footer), issuedAt);
      const sha256 = createHash('sha256').update(pdf).digest('hex');
      const record: SignedRecord = {
        verificationId,
        documentId,
        documentType: template.type,
        templateVersion: template.version,
        disclosureLevel: template.disclosureLevel,
        issuerTenant: request.tenant,
        issuedAt: issuedAt.toISOString(),
        sha256,
        publicPayload,
        status: 'valid',
        statusReasonCategory: null,
        supersededBy: null,
        statusChangedAt: null,
        expiresAt: null,
      };
      const signature = await this.records.sign(record);
      await this.store(objectKey, pdf);
      stored = true;

      const created = await withTenant(
        this.db,
        { tenant: request.tenant, subject: request.actor },
        async (tx) => {
          const [document] = await tx
            .insert(issuedDocuments)
            .values({
              id: documentId,
              tenant: request.tenant,
              type: template.type,
              templateVersion: template.version,
              disclosureLevel: template.disclosureLevel,
              subjectRef: request.subjectRef,
              subjectPersonId: request.subjectPersonId,
              reference: template.reference(payload),
              subjectVersion: template.subjectVersion(payload),
              verificationId,
              objectKey,
              sha256,
              size: pdf.length,
              signerName: certificates.signerName,
              signerCertificateSha256: certificates.certificateSha256,
              issuedAt,
              issuedBy: request.actor,
              downloadExpiresAt,
              additionalDownloaders: request.additionalDownloaders ?? [],
            })
            .onConflictDoNothing({ target: [issuedDocuments.type, issuedDocuments.subjectRef] })
            .returning();
          // A concurrent issue for the same subject won; this one registers nothing.
          if (!document) return undefined;
          const [inserted] = await tx
            .insert(verificationRecords)
            .values({
              id: verificationId,
              documentId,
              tenant: request.tenant,
              documentType: template.type,
              templateVersion: template.version,
              disclosureLevel: template.disclosureLevel,
              issuedAt,
              contentSha256: sha256,
              publicPayload,
              recordSignature: signature.signature,
              recordSigningKeyVersion: signature.keyVersion,
            })
            .returning();
          if (!inserted) throw new Error('verification record insert returned nothing');
          await this.events.record(tx, {
            type: DOCUMENT_ISSUED,
            subject: documentId,
            tenant: request.tenant,
            data: this.eventData(document, inserted) satisfies DocumentIssuedData,
          });
          return this.toIssuedDocument(document, inserted);
        },
      );
      if (created) return { document: created, created: true };
    } catch (error) {
      if (stored) await this.deleteQuietly(objectKey);
      if (error instanceof IssuanceDependencyUnavailable) {
        this.logger.error(
          { err: errorType(error), cause: error.message, dependency: error.dependency },
          'Issuing a document failed',
        );
        throw dependencyProblem(error, 'issue');
      }
      throw error;
    }
    await this.deleteQuietly(objectKey);
    const winner = await this.findBySubject(request.tenant, request.type, request.subjectRef);
    if (!winner) throw new Error(`document for ${request.subjectRef} vanished`);
    return { document: winner, created: false };
  }

  /**
   * The fields the template renders: the request's own, or those the review service holds for
   * the letter's record (pulled for the same tenant). A record the review service does not hold
   * is a refused request (400), and so is a request naming another person than the record's
   * declarant as the one who may download the letter; a review service that fails is a 502, so
   * the caller retries.
   */
  private async fieldsOf(
    request: IssueRequest,
    clarificationId: string | null,
  ): Promise<{ payload: unknown; pulled: boolean }> {
    if (clarificationId === null) return { payload: request.payload, pulled: false };
    let pulled: unknown;
    try {
      pulled = await this.review.clarificationLetterPayload(request.tenant, clarificationId);
    } catch (error) {
      if (error instanceof ClarificationNotFound) {
        throw validationProblem([
          {
            path: 'payload.clarificationId',
            message: 'The review service holds no issued clarification with this id for the tenant',
          },
        ]);
      }
      if (error instanceof ReviewUnavailable) {
        this.logger.error(
          { err: errorType(error), cause: error.message, dependency: 'review' },
          'Pulling a letter payload failed',
        );
        throw dependencyProblem(
          new IssuanceDependencyUnavailable('review', error.message, { cause: error }),
          'issue',
        );
      }
      throw error;
    }
    const subject = letterSubject.safeParse(pulled);
    if (!subject.success) {
      throw validationProblem([
        { path: 'payload', message: 'The pulled payload names no declarant person id' },
      ]);
    }
    const { declarantPersonId, ...payload } = subject.data;
    if (request.subjectPersonId !== declarantPersonId) {
      throw validationProblem([
        {
          path: 'subjectPersonId',
          message: "Must be the clarification's declarant, who alone may download the letter",
        },
      ]);
    }
    return { payload, pulled: true };
  }

  /**
   * Marks a valid document superseded by a newer valid one of the same type and tenant, re-signs
   * its record and emits `document.superseded.v1`. 404 when the document is not the tenant's;
   * 409 when it is not valid (superseding twice) or the newer one is not a valid document of
   * the type; 502 when the signer fails (nothing changes). The record is signed with no lock
   * held (the signer is OpenBao), then written only if neither record changed meanwhile; if one
   * did (another supersede won), it is checked and signed again.
   */
  async supersede(request: SupersedeRequest): Promise<IssuedDocument> {
    if (request.documentId === request.supersededBy) {
      throw supersedingInvalid('A document cannot supersede itself.');
    }
    const context = { tenant: request.tenant, subject: request.actor };
    return this.changeStatus(request.documentId, async () => {
      const read = await withTenant(this.db, context, async (tx) => ({
        current: await findRecord(tx, request.documentId),
        newer: await findRecord(tx, request.supersededBy),
      }));
      const { current, newer } = supersedable(notFoundIfInvisible(read.current), read.newer);
      const statusChangedAt = this.clock.now();
      const signature = await this.records.sign({
        ...signedRecordOf(current.record),
        status: 'superseded',
        supersededBy: newer.record.id,
        statusChangedAt: statusChangedAt.toISOString(),
      });

      return withTenant(this.db, context, async (tx) => {
        const locked = await this.lockedRecord(tx, current.document.id);
        const lockedNewer = await this.lockedRecord(tx, newer.document.id);
        if (!unchanged(locked, current) || !unchanged(lockedNewer, newer)) return null;
        const [updated] = await tx
          .update(verificationRecords)
          .set({
            status: 'superseded',
            supersededBy: newer.document.id,
            statusChangedAt,
            recordSignature: signature.signature,
            recordSigningKeyVersion: signature.keyVersion,
          })
          .where(eq(verificationRecords.id, current.record.id))
          .returning();
        if (!updated) throw new Error('verification record update returned nothing');
        await this.events.record(tx, {
          type: DOCUMENT_SUPERSEDED,
          subject: current.document.id,
          tenant: request.tenant,
          data: {
            ...this.eventData(current.document, updated),
            supersededBy: newer.document.id,
            supersededByVerificationId: newer.record.id,
            statusChangedAt: statusChangedAt.toISOString(),
          } satisfies DocumentSupersededData,
        });
        return this.toIssuedDocument(current.document, updated);
      });
    });
  }

  /**
   * Revokes a valid document with the reason (a clarification letter withdrawn as issued in
   * error), re-signs its record and emits `document.revoked.v1`, so the verify page shows it
   * revoked. 404 when the document is not the tenant's; 409 when it is not valid (revoked,
   * superseded or expired already); 502 when the signer fails (nothing changes). Signed with no lock held,
   * as a supersede is.
   */
  async revoke(request: RevokeRequest): Promise<IssuedDocument> {
    const context = { tenant: request.tenant, subject: request.actor };
    return this.changeStatus(request.documentId, async () => {
      const current = mustBeValid(
        notFoundIfInvisible(
          await withTenant(this.db, context, (tx) => findRecord(tx, request.documentId)),
        ),
      );
      const statusChangedAt = this.clock.now();
      const signature = await this.records.sign({
        ...signedRecordOf(current.record),
        status: 'revoked',
        statusReasonCategory: request.reason,
        statusChangedAt: statusChangedAt.toISOString(),
      });

      return withTenant(this.db, context, async (tx) => {
        if (!unchanged(await this.lockedRecord(tx, current.document.id), current)) return null;
        const [updated] = await tx
          .update(verificationRecords)
          .set({
            status: 'revoked',
            statusReasonCategory: request.reason,
            statusChangedAt,
            recordSignature: signature.signature,
            recordSigningKeyVersion: signature.keyVersion,
          })
          .where(eq(verificationRecords.id, current.record.id))
          .returning();
        if (!updated) throw new Error('verification record update returned nothing');
        await this.events.record(tx, {
          type: DOCUMENT_REVOKED,
          subject: current.document.id,
          tenant: request.tenant,
          data: {
            ...this.eventData(current.document, updated),
            reasonCategory: request.reason,
            statusChangedAt: statusChangedAt.toISOString(),
          } satisfies DocumentRevokedData,
        });
        return this.toIssuedDocument(current.document, updated);
      });
    });
  }

  /**
   * Runs a status change until it lands: each attempt reads and checks the records, signs the new
   * record with no lock held, then writes it only if the records did not change meanwhile, else
   * answers null and is made again (checked again, so the change that won may refuse it). A
   * signer failure is 502.
   */
  private async changeStatus(
    documentId: string,
    attempt: () => Promise<IssuedDocument | null>,
  ): Promise<IssuedDocument> {
    try {
      for (let attempts = 1; ; attempts++) {
        const changed = await attempt();
        if (changed) return changed;
        if (attempts === MAX_STATUS_CHANGE_ATTEMPTS) {
          throw new Error(`Document ${documentId} kept changing during its status change`);
        }
      }
    } catch (error) {
      if (error instanceof IssuanceDependencyUnavailable) {
        throw dependencyProblem(error, 'statusChange');
      }
      throw error;
    }
  }

  /**
   * Records `document.issued.v1` again for a document issued earlier, with its record as it is
   * now: for a consumer that missed the first announcement (a reissue of a slip that was issued).
   * 404 when the document is not the tenant's.
   */
  async announce(tenant: string, actor: string, documentId: string): Promise<void> {
    await withTenant(this.db, { tenant, subject: actor }, async (tx) => {
      const [row] = await withRecord(tx).where(eq(issuedDocuments.id, documentId));
      const found = notFoundIfInvisible(row);
      await this.events.record(tx, {
        type: DOCUMENT_ISSUED,
        subject: found.document.id,
        tenant,
        data: this.eventData(found.document, found.record) satisfies DocumentIssuedData,
      });
    });
  }

  /**
   * The tenant's valid documents of the type about the reference number, with the version of
   * what each is about (null when it has none): e.g. the acknowledgement slips of a
   * declaration's versions not yet superseded.
   */
  async validOfReference(
    tenant: string,
    type: DocumentType,
    reference: string,
  ): Promise<{ documentId: string; version: number | null }[]> {
    const rows = await withTenant(this.db, { tenant, subject: SYSTEM_SUBJECT }, (tx) =>
      withRecord(tx).where(
        and(
          eq(issuedDocuments.tenant, tenant),
          eq(issuedDocuments.type, type),
          eq(issuedDocuments.reference, reference),
          eq(verificationRecords.status, 'valid'),
        ),
      ),
    );
    return rows.map(({ document }) => ({
      documentId: document.id,
      version: document.subjectVersion,
    }));
  }

  /** A document the caller may download (see `download`); anyone else gets 404. */
  async getOwned(caller: Downloader, id: string): Promise<IssuedDocument> {
    const { document, record } = await this.owned(caller, id);
    return this.toIssuedDocument(document, record);
  }

  /**
   * A five-minute presigned GET of the signed PDF, for the subject person and the issuing
   * Commission's staff named as additional downloaders only (404 for anyone else), and only
   * within the document's download window (410 `download-window-closed` after it). Each link
   * handed out is to be recorded as `downloaded`, `document.downloaded.v1` under the issuer, which
   * the route records with the read's audit event, in one insert.
   */
  async download(
    caller: Downloader,
    id: string,
  ): Promise<{
    download: DocumentDownload;
    document: DocumentRow;
    downloaded: NewEvent<DocumentDownloadedData>;
  }> {
    const { subject } = caller;
    const { document, record } = await this.owned(caller, id);
    const now = this.clock.now();
    if (document.downloadExpiresAt && now >= document.downloadExpiresAt) {
      throw ProblemException.fromCode('download-window-closed', {
        detail: `The document could be downloaded until ${document.downloadExpiresAt.toISOString()}.`,
      });
    }
    return {
      download: await this.presigned(document, now),
      document,
      downloaded: {
        type: DOCUMENT_DOWNLOADED,
        subject: document.id,
        tenant: document.tenant,
        data: {
          documentId: document.id,
          verificationId: record.id,
          documentType: document.type,
          issuerTenant: document.tenant,
          subjectRef: document.subjectRef,
          downloadedBy: subject,
          downloadedAt: now.toISOString(),
          downloadExpiresAt: document.downloadExpiresAt?.toISOString() ?? null,
        },
      },
    };
  }

  /**
   * A five-minute presigned GET of the signed PDF of a document the tenant issued, for the
   * service acting for it (the review service, for its staff: a reviewer opening a letter of a
   * case). 404 for another tenant's document.
   */
  async downloadForTenant(
    tenant: string,
    actor: string,
    id: string,
  ): Promise<{ download: DocumentDownload; document: DocumentRow }> {
    const found = await withTenant(this.db, { tenant, subject: actor }, (tx) => findRecord(tx, id));
    const { document } = notFoundIfInvisible(found);
    return { download: await this.presigned(document, this.clock.now()), document };
  }

  private async presigned(document: DocumentRow, now: Date): Promise<DocumentDownload> {
    const downloadUrl = await getSignedUrl(
      this.publicS3,
      new GetObjectCommand({
        Bucket: config.S3_BUCKET_ISSUED,
        Key: document.objectKey,
        // An attachment, so the browser saves the PDF and the page that asked stays open.
        ResponseContentDisposition: `attachment; filename="${downloadFileName(document)}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    const expiresAt = new Date(now.getTime() + DOWNLOAD_URL_TTL_SECONDS * 1000);
    return { downloadUrl, expiresAt: expiresAt.toISOString(), sha256: document.sha256 };
  }

  /**
   * The document when the caller is its subject person (read under the person policy across
   * Commissions) or, failing that, an access officer of the issuing Commission named among its
   * additional downloaders (read in their own tenant's context): one who is no longer an access
   * officer there downloads it no more. Anyone else gets the same 404.
   */
  private async owned(
    { personId, subject, tenant, roles }: Downloader,
    id: string,
  ): Promise<{ document: DocumentRow; record: RecordRow }> {
    const [asSubjectPerson] = personId
      ? await withPerson(this.db, { personId, subject }, (tx) =>
          withRecord(tx).where(eq(issuedDocuments.id, id)),
        )
      : [];
    if (asSubjectPerson) return asSubjectPerson;
    const [asDownloader] =
      tenant && roles.includes(ACCESS_OFFICER)
        ? await withTenant(this.db, { tenant, subject }, (tx) =>
            withRecord(tx).where(
              and(
                eq(issuedDocuments.id, id),
                eq(issuedDocuments.tenant, tenant),
                arrayContains(issuedDocuments.additionalDownloaders, [subject]),
              ),
            ),
          )
        : [];
    return notFoundIfInvisible(asDownloader);
  }

  private async findBySubject(
    tenant: string,
    type: DocumentType,
    subjectRef: string,
  ): Promise<IssuedDocument | undefined> {
    const [found] = await withTenant(this.db, { tenant, subject: SYSTEM_SUBJECT }, (tx) =>
      withRecord(tx).where(
        and(eq(issuedDocuments.type, type), eq(issuedDocuments.subjectRef, subjectRef)),
      ),
    );
    return found ? this.toIssuedDocument(found.document, found.record) : undefined;
  }

  /** A document with its record, the record locked for the rest of the transaction. */
  private async lockedRecord(tx: Tx, id: string): Promise<DocumentWithRecord | undefined> {
    const [found] = await withRecord(tx)
      .where(eq(issuedDocuments.id, id))
      .for('update', { of: verificationRecords });
    return found;
  }

  private async store(key: string, pdf: Buffer): Promise<void> {
    try {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET_ISSUED,
          Key: key,
          Body: pdf,
          ContentType: 'application/pdf',
          ContentLength: pdf.length,
          ServerSideEncryption: 'AES256',
        }),
      );
    } catch (error) {
      throw new IssuanceDependencyUnavailable('storage', 'Storing the PDF failed', {
        cause: error,
      });
    }
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET_ISSUED, Key: key }));
    } catch (error) {
      this.logger.warn({ err: errorType(error), key }, 'Deleting an unregistered PDF failed');
    }
  }

  private verifyUrlOf(verificationId: string): string {
    return new URL(`/v/${verificationId}`, this.verifyBaseUrl).toString();
  }

  /** The fields of every document event: identifiers and the public payload, nothing else. */
  private eventData(document: DocumentRow, record: RecordRow): DocumentEventData {
    return {
      documentId: document.id,
      verificationId: record.id,
      documentType: document.type,
      templateVersion: document.templateVersion,
      disclosureLevel: document.disclosureLevel,
      issuerTenant: document.tenant,
      subjectRef: document.subjectRef,
      publicPayload: record.publicPayload,
      verifyUrl: this.verifyUrlOf(record.id),
      sha256: document.sha256,
      issuedAt: document.issuedAt.toISOString(),
      status: record.status,
    };
  }

  private toIssuedDocument(document: DocumentRow, record: RecordRow): IssuedDocument {
    return {
      id: document.id,
      type: document.type as DocumentType,
      templateVersion: document.templateVersion,
      disclosureLevel: document.disclosureLevel,
      issuerTenant: document.tenant,
      subjectRef: document.subjectRef,
      verificationId: document.verificationId,
      verifyUrl: this.verifyUrlOf(document.verificationId),
      sha256: document.sha256,
      status: record.status,
      supersededBy: record.supersededBy,
      issuedAt: document.issuedAt.toISOString(),
      downloadExpiresAt: document.downloadExpiresAt?.toISOString() ?? null,
    };
  }
}

/** What the request lacks of what the template requires, as validation errors. */
function missingRequirements(
  template: DocumentTemplate,
  request: IssueRequest,
): { path: string; message: string }[] {
  const requires = template.requires ?? {};
  const missing: { path: string; message: string }[] = [];
  const required = (path: string) =>
    missing.push({ path, message: `Required for ${template.type} documents` });
  if (requires.subjectPerson && request.subjectPersonId === null) required('subjectPersonId');
  if (requires.watermark && !request.watermark) required('watermark');
  if (requires.downloadWindow && request.downloadWindowDays === undefined) {
    required('downloadWindowDays');
  }
  return missing;
}

/** Documents with their verification records; the caller adds the filter. */
function withRecord(tx: Tx) {
  return tx
    .select({ document: issuedDocuments, record: verificationRecords })
    .from(issuedDocuments)
    .innerJoin(verificationRecords, eq(verificationRecords.documentId, issuedDocuments.id));
}

/** A document with its verification record, unlocked; undefined when not visible. */
async function findRecord(tx: Tx, id: string): Promise<DocumentWithRecord | undefined> {
  const [found] = await withRecord(tx).where(eq(issuedDocuments.id, id));
  return found;
}

/**
 * The pair, when `current` may be superseded by `newer`: 409 `document-not-valid` when it is not
 * valid, `superseding-document-invalid` when the newer one is not a valid document of its type.
 */
function supersedable(
  current: DocumentWithRecord,
  newer: DocumentWithRecord | undefined,
): { current: DocumentWithRecord; newer: DocumentWithRecord } {
  mustBeValid(current);
  if (newer?.record.status !== 'valid' || newer.document.type !== current.document.type) {
    throw supersedingInvalid('The newer document must be a valid document of the same type.');
  }
  return { current, newer };
}

/** The document, when valid; 409 `document-not-valid` when superseded, revoked or expired. */
function mustBeValid(current: DocumentWithRecord): DocumentWithRecord {
  if (current.record.status !== 'valid') {
    throw new ProblemException({
      type: 'document-not-valid',
      title: 'Document is not valid',
      status: HttpStatus.CONFLICT,
      detail: `The document is ${current.record.status} already.`,
    });
  }
  return current;
}

/** Whether a record, locked now, is as it was read: a status change re-signs it. */
function unchanged(locked: DocumentWithRecord | undefined, read: DocumentWithRecord): boolean {
  return (
    locked?.record.status === read.record.status &&
    locked.record.recordSignature === read.record.recordSignature
  );
}

/** The signed form of a stored record whose superseding document is not needed (valid). */
function signedRecordOf(record: RecordRow): SignedRecord {
  return {
    verificationId: record.id,
    documentId: record.documentId,
    documentType: record.documentType,
    templateVersion: record.templateVersion,
    disclosureLevel: record.disclosureLevel,
    issuerTenant: record.tenant,
    issuedAt: record.issuedAt.toISOString(),
    sha256: record.contentSha256,
    publicPayload: record.publicPayload,
    status: record.status,
    statusReasonCategory: record.statusReasonCategory,
    supersededBy: null,
    statusChangedAt: record.statusChangedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}

function validationProblem(errors: { path: string; message: string }[]): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Validation failed',
    status: HttpStatus.BAD_REQUEST,
    errors,
  });
}

function supersedingInvalid(detail: string): ProblemException {
  return new ProblemException({
    type: 'superseding-document-invalid',
    title: 'Superseding document is not valid',
    status: HttpStatus.CONFLICT,
    detail,
  });
}
