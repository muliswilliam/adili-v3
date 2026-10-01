import { Inject, Injectable, Logger } from '@nestjs/common';
import { errorType, notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, switchTenant, withPerson } from '@adili/data-access';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';

import { declarantPersonId } from '../access.js';
import { Clock } from '../clock.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import {
  ACCESS_REPRESENTATION_PURPOSE,
  DocumentsClient,
  DocumentsUnavailable,
  UploadNotClean,
  UploadNotFound,
} from '../documents/documents-client.js';
import { badRequest, documentsUnavailable, problem, type ProblemError } from '../problems.js';
import { AccessRegister } from '../register/access-register.js';
import { openFormK } from '../requests/form-k.js';
import { AccessRequestWorkflows } from '../requests/request-workflows.js';
import type { AccessRequestRow } from '../requests/representation.js';
import {
  accessRequests,
  type RepresentationAttachment,
  representations,
} from '../requests/schema.js';
import {
  type DeclarantNotice,
  type RepresentationsInput,
  toDeclarantNotice,
  windowOpen,
} from './representation.js';

/**
 * What a declarant sees of the access requests about them (spec 10, Act s.36(3)): those they
 * have been notified of, with who asked, why and for what, and their representations, which they
 * make and change while the window is open. Read through the person axis: a request about
 * someone else, or one not yet notified, is 404.
 */
@Injectable()
export class NoticesService {
  private readonly logger = new Logger(NoticesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: AccessDatabase,
    private readonly documents: DocumentsClient,
    private readonly cipher: FieldCipher,
    private readonly register: AccessRegister,
    private readonly workflows: AccessRequestWorkflows,
    private readonly clock: Clock,
  ) {}

  /** The declarant's notices, latest notified first. */
  async list(principal: Principal): Promise<DeclarantNotice[]> {
    const personId = declarantPersonId(principal);
    const { rows, byRequest } = await withPerson(
      this.db,
      { personId, subject: principal.subject },
      async (tx) => {
        const rows = await tx
          .select()
          .from(accessRequests)
          .where(
            and(
              eq(accessRequests.resolvedPersonId, personId),
              isNotNull(accessRequests.notifiedAt),
            ),
          )
          .orderBy(desc(accessRequests.notifiedAt), desc(accessRequests.id));
        const made =
          rows.length === 0
            ? []
            : await tx
                .select()
                .from(representations)
                .where(
                  inArray(
                    representations.requestId,
                    rows.map((row) => row.id),
                  ),
                );
        return { rows, byRequest: new Map(made.map((row) => [row.requestId, row])) };
      },
    );
    const now = this.clock.now();
    return Promise.all(
      rows.map(async (row) =>
        toDeclarantNotice(
          row,
          await openFormK(this.cipher, row),
          byRequest.get(row.id) ?? null,
          now,
        ),
      ),
    );
  }

  /**
   * Makes or changes the declarant's representations on a request about them (S4), while the
   * window is open: after it closes (or once they consented, or the request closed), 409
   * `representations-closed`. Attachments must be clean uploads of purpose
   * `access-representation` the declarant made (400 at `attachments.<n>` otherwise); they are
   * marked linked in documents before the save, and the ones taken off are released after it.
   * Each save is a `representations` register entry and event. `consent` sends the request
   * `under-decision` at once and ends the window.
   */
  async submit(
    principal: Principal,
    requestId: string,
    input: RepresentationsInput,
  ): Promise<DeclarantNotice> {
    const personId = declarantPersonId(principal);
    const person = { personId, subject: principal.subject };
    const notice = notFoundIfInvisible(
      await withPerson(this.db, person, (tx) => noticeRow(tx, personId, requestId)),
    );
    requireOpen(notice, this.clock.now());
    const attachments = await this.cleanAttachments(principal, notice.tenant, input.attachments);
    await this.link(notice.tenant, input.attachments);

    const { row, saved, released } = await withPerson(this.db, person, async (tx) => {
      const own = notFoundIfInvisible(await noticeRow(tx, personId, requestId));
      // The request and its register belong to the Commission: lock it there, so the window
      // cannot close (nor the request be withdrawn) between the check and the save.
      await switchTenant(tx, { tenant: own.tenant, subject: principal.subject });
      const [locked] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, own.id))
        .for('update');
      const current = notFoundIfInvisible(locked);
      const now = this.clock.now();
      requireOpen(current, now);

      const [previous] = await tx
        .select()
        .from(representations)
        .where(eq(representations.requestId, current.id));
      const values = { stance: input.stance, text: input.text, attachments };
      const [saved] = await tx
        .insert(representations)
        .values({
          requestId: current.id,
          tenant: current.tenant,
          personId,
          ...values,
          submittedAt: now,
        })
        .onConflictDoUpdate({
          target: representations.requestId,
          set: { ...values, updatedAt: now },
        })
        .returning();
      if (!saved) throw new Error('The representations were not saved');

      const row = input.stance === 'consent' ? await consent(tx, current.id) : current;
      await this.register.record(tx, {
        tenant: current.tenant,
        subjectKind: 'access-request',
        subjectId: current.id,
        reference: current.reference,
        personId,
        kind: 'representations',
        actor: { subject: principal.subject, name: principal.name },
        at: now,
        details: {
          stance: input.stance,
          attachments: attachments.length,
          amended: previous !== undefined,
        },
      });
      const kept = new Set(input.attachments);
      return {
        row,
        saved,
        released: (previous?.attachments ?? [])
          .map((attachment) => attachment.uploadId)
          .filter((uploadId) => !kept.has(uploadId)),
      };
    });

    await this.release(row.tenant, released);
    if (input.stance === 'consent') await this.workflows.signal(row.id, 'consented');
    return toDeclarantNotice(row, await openFormK(this.cipher, row), saved, this.clock.now());
  }

  /** Each upload, checked: clean, of purpose `access-representation`, and the declarant's own. */
  private async cleanAttachments(
    principal: Principal,
    tenant: string,
    uploadIds: readonly string[],
  ): Promise<RepresentationAttachment[]> {
    const errors: ProblemError[] = [];
    const attachments: RepresentationAttachment[] = [];
    for (const [index, uploadId] of uploadIds.entries()) {
      const path = `attachments.${String(index)}`;
      try {
        const upload = await this.documents.getCleanUpload(tenant, uploadId);
        if (upload.purpose !== ACCESS_REPRESENTATION_PURPOSE) {
          errors.push({ path, message: `is not an upload for ${ACCESS_REPRESENTATION_PURPOSE}` });
        } else if (upload.uploadedBy !== principal.subject) {
          errors.push({ path, message: 'is not an upload of yours' });
        } else {
          attachments.push({ uploadId, fileName: upload.fileName ?? 'attachment' });
        }
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
      }
    }
    if (errors.length > 0) throw badRequest('Some attachments cannot be used.', errors);
    return attachments;
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

  /** Releases uploads taken off to the orphan sweep; a failure only leaves them kept. */
  private async release(tenant: string, uploadIds: readonly string[]): Promise<void> {
    for (const uploadId of uploadIds) {
      try {
        await this.documents.markUnlinked(tenant, uploadId);
      } catch (error) {
        this.logger.warn({ uploadId, err: errorType(error) }, 'Could not release an attachment');
      }
    }
  }
}

/** A request about the declarant they have been notified of, as their person context sees it. */
async function noticeRow(
  tx: AccessTransaction,
  personId: string,
  requestId: string,
): Promise<AccessRequestRow | undefined> {
  const [row] = await tx
    .select()
    .from(accessRequests)
    .where(
      and(
        eq(accessRequests.id, requestId),
        eq(accessRequests.resolvedPersonId, personId),
        isNotNull(accessRequests.notifiedAt),
      ),
    );
  return row;
}

/** The declarant consented: the request goes under decision now, the window has done its work. */
async function consent(tx: AccessTransaction, requestId: string): Promise<AccessRequestRow> {
  const [updated] = await tx
    .update(accessRequests)
    .set({ status: 'under-decision' })
    .where(eq(accessRequests.id, requestId))
    .returning();
  if (!updated) throw new Error('The access request was not updated');
  return updated;
}

function requireOpen(row: AccessRequestRow, now: Date): void {
  if (!windowOpen(row, now)) {
    throw problem(
      'representations-closed',
      'The window for representations on this request is closed.',
    );
  }
}
