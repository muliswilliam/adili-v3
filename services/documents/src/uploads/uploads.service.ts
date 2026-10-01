import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { PLATFORM_TENANT, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { config } from '../config.js';
import type { DocumentsSchema } from '../db/schema.js';
import { MalwareScanner } from '../scanning/malware-scanner.js';
import { S3, S3_PUBLIC } from '../storage/storage.module.js';
import { CSV, type DetectedType, policyOf, purposesFor } from './purposes.js';
import type {
  CreateUploadBody,
  Upload,
  UploadDownload,
  UploadReservation,
} from './representation.js';
import { detectType, NOT_UTF8_TEXT } from './sniff.js';
import { type UploadRejection, uploads } from './schema.js';

/** Injection token of the completion time budget in milliseconds (60 s in the service). */
export const COMPLETE_BUDGET_MS = Symbol('COMPLETE_BUDGET_MS');

/** Lifespan of the presigned PUT to quarantine. */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Lifespan of the presigned GET on a clean object handed to services. */
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/**
 * A completion that started longer ago than this has died (its budget is 60 s), so another
 * completion or the expiry sweep may take the upload over.
 */
const STALE_COMPLETION = sql`now() - interval '2 minutes'`;

type UploadRow = typeof uploads.$inferSelect;

/** How a completion ends; `clean` carries what the clean object is. */
type Outcome =
  | { state: 'clean'; size: number; sha256: string; detectedType: DetectedType }
  | { state: 'infected'; size: number; threat: string }
  | { state: 'rejected'; rejection: UploadRejection; size: number | null };

/** The object in quarantine changed or vanished while it was being checked. */
class ObjectGone extends Error {}

/**
 * Presigned uploads (ADR-002): the browser PUTs straight to the quarantine bucket, completion
 * checks size and type, streams the bytes through ClamAV and moves clean files to the clean
 * bucket with server-side encryption. Uploads are tenant-scoped under RLS.
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DocumentsSchema>,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(S3_PUBLIC) private readonly publicS3: S3Client,
    private readonly scanner: MalwareScanner,
    @Inject(COMPLETE_BUDGET_MS) private readonly completeBudgetMs: number,
  ) {}

  /** Reserves an upload for the caller's tenant and presigns the PUT to quarantine. */
  async create(principal: Principal, body: CreateUploadBody): Promise<UploadReservation> {
    const tenant = tenantOf(principal);
    if (!tenant || !purposesFor(principal.roles).includes(body.purpose)) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Forbidden',
        status: HttpStatus.FORBIDDEN,
        detail: `Your roles do not allow ${body.purpose} uploads.`,
      });
    }
    const policy = policyOf(body.purpose);
    const errors = [];
    if (!(policy.contentTypes as readonly string[]).includes(body.contentType)) {
      errors.push({
        path: 'contentType',
        message: `Must be one of ${policy.contentTypes.join(', ')}`,
      });
    }
    if (body.declaredSize > policy.maxSize) {
      errors.push({ path: 'declaredSize', message: `Must be at most ${policy.maxSize} bytes` });
    }
    if (errors.length > 0) {
      throw new ProblemException({
        type: 'about:blank',
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        errors,
      });
    }

    const id = uuidv7();
    const key = `${body.purpose}/${id}`;
    const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000);
    await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx.insert(uploads).values({
        id,
        tenant,
        purpose: body.purpose,
        declaredContentType: body.contentType,
        declaredSize: body.declaredSize,
        fileName: body.fileName ?? null,
        quarantineKey: key,
        createdBy: principal.subject,
        expiresAt,
      }),
    );
    // Content type and length are signed, so storage refuses any other body.
    const uploadUrl = await getSignedUrl(
      this.publicS3,
      new PutObjectCommand({
        Bucket: config.S3_BUCKET_QUARANTINE,
        Key: key,
        ContentType: body.contentType,
        ContentLength: body.declaredSize,
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return { id, uploadUrl, expiresAt: expiresAt.toISOString(), maxSize: policy.maxSize };
  }

  async get(principal: Principal, id: string): Promise<Upload> {
    return toUpload(await this.visible(principal, id));
  }

  /**
   * Checks the uploaded object and settles the upload: `rejected` (missing, size, type or
   * timeout), `infected`, or `clean` with its SHA-256 once the bytes are in the clean bucket.
   * The quarantine object is deleted whatever the outcome.
   */
  async complete(principal: Principal, id: string): Promise<Upload> {
    const upload = await this.visible(principal, id);
    if (upload.state !== 'awaiting-upload') throw notAwaitingUpload(upload);
    const context = { tenant: upload.tenant, subject: principal.subject };
    const [claimed] = await withTenant(this.db, context, (tx) =>
      tx
        .update(uploads)
        .set({ completionStartedAt: sql`now()` })
        .where(
          and(
            eq(uploads.id, id),
            eq(uploads.state, 'awaiting-upload'),
            or(
              isNull(uploads.completionStartedAt),
              lt(uploads.completionStartedAt, STALE_COMPLETION),
            ),
          ),
        )
        .returning(),
    );
    if (!claimed) throw notAwaitingUpload(await this.visible(principal, id));

    const budget = AbortSignal.timeout(this.completeBudgetMs);
    let outcome: Outcome;
    try {
      outcome = await this.inspect(claimed, budget);
    } catch (error) {
      if (budget.aborted) {
        outcome = { state: 'rejected', rejection: 'timeout', size: null };
      } else {
        await withTenant(this.db, context, (tx) =>
          tx.update(uploads).set({ completionStartedAt: null }).where(eq(uploads.id, id)),
        );
        this.logger.error({ err: error, uploadId: id }, 'Completing an upload failed');
        throw new ProblemException({
          type: 'upload-check-unavailable',
          title: 'Upload could not be checked',
          status: HttpStatus.SERVICE_UNAVAILABLE,
          detail: 'Storage or the malware scanner is unavailable. Nothing changed; try again.',
        });
      }
    }
    await this.deleteQuietly(config.S3_BUCKET_QUARANTINE, claimed.quarantineKey);
    if (outcome.state === 'rejected' && outcome.rejection === 'timeout') {
      // The budget may have run out while the copy to the clean bucket was in flight.
      await this.deleteQuietly(config.S3_BUCKET_CLEAN, claimed.quarantineKey);
    }

    const [settled] = await withTenant(this.db, context, (tx) =>
      tx
        .update(uploads)
        .set({
          state: outcome.state,
          rejection: outcome.state === 'rejected' ? outcome.rejection : null,
          threat: outcome.state === 'infected' ? outcome.threat : null,
          size: outcome.size,
          sha256: outcome.state === 'clean' ? outcome.sha256 : null,
          detectedType: outcome.state === 'clean' ? outcome.detectedType : null,
          cleanKey: outcome.state === 'clean' ? claimed.quarantineKey : null,
          completedAt: sql`now()`,
          completionStartedAt: null,
        })
        .where(eq(uploads.id, id))
        .returning(),
    );
    if (!settled) throw new Error(`upload ${id} vanished while completing`);
    return toUpload(settled);
  }

  /**
   * A short-lived presigned GET on a clean upload of `actingTenant`, for services: invisible
   * uploads are 404, uploads that are not clean 409.
   */
  async download(caller: Principal, actingTenant: string, id: string): Promise<UploadDownload> {
    const [upload] = await withTenant(
      this.db,
      { tenant: actingTenant, subject: caller.subject },
      (tx) => tx.select().from(uploads).where(eq(uploads.id, id)),
    );
    if (!upload) throw notFound();
    if (upload.state !== 'clean' || !upload.cleanKey) {
      throw new ProblemException({
        type: 'upload-not-clean',
        title: 'Upload is not clean',
        status: HttpStatus.CONFLICT,
        detail: `The upload is ${upload.state}; only clean uploads can be downloaded.`,
      });
    }
    const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000);
    const downloadUrl = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: config.S3_BUCKET_CLEAN, Key: upload.cleanKey }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
    return {
      id: upload.id,
      purpose: upload.purpose,
      state: 'clean',
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
      sha256: requireValue(upload.sha256),
      size: requireValue(upload.size),
      fileName: upload.fileName,
      detectedType: requireValue(upload.detectedType),
    };
  }

  /**
   * Marks uploads still awaiting their bytes after the PUT expired as `expired` and deletes any
   * quarantine object they left. Idempotent, so every replica may run it. Returns the count.
   */
  async expireStale(): Promise<number> {
    const expired = await withTenant(
      this.db,
      { tenant: PLATFORM_TENANT, subject: 'system' },
      (tx) =>
        tx
          .update(uploads)
          .set({ state: 'expired' })
          .where(
            and(
              eq(uploads.state, 'awaiting-upload'),
              lt(uploads.expiresAt, sql`now()`),
              or(
                isNull(uploads.completionStartedAt),
                lt(uploads.completionStartedAt, STALE_COMPLETION),
              ),
            ),
          )
          .returning({ key: uploads.quarantineKey }),
    );
    for (const { key } of expired) {
      await this.deleteQuietly(config.S3_BUCKET_QUARANTINE, key);
    }
    return expired.length;
  }

  /** The upload when the caller's tenant owns it and their roles cover its purpose; else 404. */
  private async visible(principal: Principal, id: string): Promise<UploadRow> {
    const tenant = tenantOf(principal);
    const purposes = purposesFor(principal.roles);
    if (!tenant || purposes.length === 0) throw notFound();
    const [upload] = await withTenant(this.db, { tenant, subject: principal.subject }, (tx) =>
      tx
        .select()
        .from(uploads)
        .where(and(eq(uploads.id, id), inArray(uploads.purpose, purposes))),
    );
    if (!upload) throw notFound();
    return upload;
  }

  private async inspect(upload: UploadRow, signal: AbortSignal): Promise<Outcome> {
    const bucket = config.S3_BUCKET_QUARANTINE;
    const key = upload.quarantineKey;
    let head;
    try {
      head = await this.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: signal,
      });
    } catch (error) {
      if (isStatus(error, 404)) return { state: 'rejected', rejection: 'missing', size: null };
      throw error;
    }
    const size = head.ContentLength ?? 0;
    const etag = head.ETag;
    if (size > policyOf(upload.purpose).maxSize || size !== upload.declaredSize) {
      return { state: 'rejected', rejection: 'size', size };
    }

    try {
      const detectedType = await detectType(async (start, end) => {
        const part = await this.s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: `bytes=${start}-${end}`,
            IfMatch: etag,
          }),
          { abortSignal: signal },
        );
        return requireValue(part.Body).transformToByteArray();
      }, size);
      if (detectedType === NOT_UTF8_TEXT) {
        // Text in another encoding is refused as such when a CSV was declared, so the officer
        // is told to save it as CSV UTF-8 rather than that it is no CSV at all.
        const rejection = upload.declaredContentType === CSV ? 'encoding' : 'type';
        return { state: 'rejected', rejection, size };
      }
      if (detectedType !== upload.declaredContentType) {
        return { state: 'rejected', rejection: 'type', size };
      }

      const object = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: etag }),
        { abortSignal: signal },
      );
      const hash = createHash('sha256');
      let scanned = 0;
      const hashed = async function* (body: Readable): AsyncIterable<Uint8Array> {
        for await (const chunk of body) {
          const bytes = chunk as Buffer;
          hash.update(bytes);
          scanned += bytes.length;
          yield bytes;
        }
      };
      const result = await this.scanner.scan(hashed(requireValue(object.Body) as Readable), signal);
      if (result.infected) return { state: 'infected', size, threat: result.signature };
      if (scanned !== size) throw new ObjectGone();

      // Server-side copy of exactly the object scanned (the ETag guards against a second PUT),
      // with the sniffed type and no metadata from the client.
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: config.S3_BUCKET_CLEAN,
          Key: key,
          CopySource: `${bucket}/${key}`,
          CopySourceIfMatch: etag,
          MetadataDirective: 'REPLACE',
          ContentType: detectedType,
          ServerSideEncryption: 'AES256',
        }),
        { abortSignal: signal },
      );
      return { state: 'clean', size, sha256: hash.digest('hex'), detectedType };
    } catch (error) {
      if (error instanceof ObjectGone || isStatus(error, 404) || isStatus(error, 412)) {
        return { state: 'rejected', rejection: 'missing', size };
      }
      throw error;
    }
  }

  private async deleteQuietly(bucket: string, key: string): Promise<void> {
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      this.logger.warn({ err: error, bucket, key }, 'Deleting an object failed');
    }
  }
}

/** The tenant a caller's uploads belong to; none for platform-wide or tenantless callers. */
function tenantOf(principal: Principal): string | null {
  return principal.tenant && principal.tenant !== PLATFORM_TENANT ? principal.tenant : null;
}

function toUpload(row: UploadRow): Upload {
  return {
    id: row.id,
    purpose: row.purpose,
    state: row.state,
    rejection: row.rejection,
    contentType: row.declaredContentType,
    detectedType: row.detectedType,
    declaredSize: row.declaredSize,
    size: row.size,
    sha256: row.sha256,
    fileName: row.fileName,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function notAwaitingUpload(upload: UploadRow): ProblemException {
  if (upload.state === 'awaiting-upload') {
    return new ProblemException({
      type: 'upload-completing',
      title: 'Upload is being completed',
      status: HttpStatus.CONFLICT,
      detail: 'Another request is completing this upload.',
    });
  }
  if (upload.state === 'expired') {
    return new ProblemException({
      type: 'upload-expired',
      title: 'Upload expired',
      status: HttpStatus.CONFLICT,
      detail: 'The upload was not completed in time. Start a new upload.',
    });
  }
  return new ProblemException({
    type: 'upload-completed',
    title: 'Upload already completed',
    status: HttpStatus.CONFLICT,
    detail: `The upload is already ${upload.state}.`,
  });
}

function notFound(): ProblemException {
  return new ProblemException({
    type: 'about:blank',
    title: 'Not Found',
    status: HttpStatus.NOT_FOUND,
    detail: 'The resource does not exist or is not visible to you.',
  });
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === status;
}

function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}
