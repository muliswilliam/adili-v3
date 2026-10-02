import { Inject, Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import { DATABASE, FieldCipher, switchTenant, withPerson } from '@adili/data-access';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { declarantPersonId } from '../access.js';
import { Clock } from '../clock.js';
import type { AccessDatabase, AccessTransaction } from '../db/database.js';
import { DocumentsClient } from '../documents/documents-client.js';
import { problem } from '../problems.js';
import { leaRequests } from '../lea/schema.js';
import { AccessRegister } from '../register/access-register.js';
import { openFormK } from '../requests/form-k.js';
import {
  cleanAttachments,
  linkUploads,
  releasedUploads,
  releaseUploads,
} from '../requests/representation-attachments.js';
import { AccessRequestWorkflows } from '../requests/request-workflows.js';
import type { AccessRequestRow } from '../requests/representation.js';
import { accessRequests, representations } from '../requests/schema.js';
import {
  type DeclarantNotice,
  type FormKDeclarantNotice,
  type RepresentationsInput,
  toDeclarantNotice,
  toLeaDeclarantNotice,
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

  /**
   * The declarant's notices, latest notified first: Form K requests once notified, law
   * enforcement requests once granted and told (r.23(2)).
   */
  async list(principal: Principal): Promise<DeclarantNotice[]> {
    const personId = declarantPersonId(principal);
    const { rows, byRequest, lea } = await withPerson(
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
        const lea = await tx
          .select()
          .from(leaRequests)
          .where(
            and(
              eq(leaRequests.resolvedPersonId, personId),
              eq(leaRequests.status, 'granted'),
              isNotNull(leaRequests.declarantNotifiedAt),
            ),
          );
        return { rows, byRequest: new Map(made.map((row) => [row.requestId, row])), lea };
      },
    );
    const now = this.clock.now();
    const formK = await Promise.all(
      rows.map(async (row) =>
        toDeclarantNotice(
          row,
          await openFormK(this.cipher, row),
          byRequest.get(row.id) ?? null,
          now,
        ),
      ),
    );
    return [...formK, ...lea.map(toLeaDeclarantNotice)].sort(
      (a, b) =>
        new Date(b.notifiedAt).getTime() - new Date(a.notifiedAt).getTime() ||
        (a.requestId < b.requestId ? 1 : a.requestId > b.requestId ? -1 : 0),
    );
  }

  /**
   * Makes or changes the declarant's representations on a request about them (S4), while the
   * window is open: after it closes (or once they consented, or the request closed), 409
   * `representations-closed`. Attachments must be clean uploads of purpose
   * `access-representation` the declarant made, or ones attached already (e.g. the scans of
   * representations the access officer entered from their letter): 400 at `attachments.<n>`
   * otherwise. They are marked linked in documents before the save, and the ones taken off are
   * released after it. Each save is a `representations` register entry and event. `consent`
   * sends the request `under-decision` at once and ends the window.
   */
  async submit(
    principal: Principal,
    requestId: string,
    input: RepresentationsInput,
  ): Promise<FormKDeclarantNotice> {
    const personId = declarantPersonId(principal);
    const person = { personId, subject: principal.subject };
    const { notice, attached } = await withPerson(this.db, person, async (tx) => {
      const notice = notFoundIfInvisible(await noticeRow(tx, personId, requestId));
      const [made] = await tx
        .select({ attachments: representations.attachments })
        .from(representations)
        .where(eq(representations.requestId, notice.id));
      return { notice, attached: made?.attachments ?? [] };
    });
    requireOpen(notice, this.clock.now());
    const attachments = await cleanAttachments(
      this.documents,
      notice.tenant,
      input.attachments,
      principal.subject,
      attached,
    );
    await linkUploads(this.documents, notice.tenant, input.attachments);

    const { row, saved, released } = await withPerson(this.db, person, async (tx) => {
      const own = notFoundIfInvisible(await noticeRow(tx, personId, requestId));
      const now = this.clock.now();
      // The request and its register belong to the Commission: lock it there first, so the
      // window cannot close (nor the request be withdrawn) before this commits. Request before
      // representations, the order every writer of both takes (the officer entering them in
      // writing, linking a declarant): the other order deadlocks with them.
      const commission = { tenant: own.tenant, subject: principal.subject };
      await switchTenant(tx, commission);
      const [locked] = await tx
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, own.id))
        .for('update');
      const current = notFoundIfInvisible(locked);
      requireOpen(current, now);

      // The representations are the declarant's own write: made under their person context
      // alone, so the person policy (their own, on a request about them they were told of)
      // admits it, not the Commission's (decisions.md #250, ADR-018).
      await leaveTenant(tx);
      const [previous] = await tx
        .select()
        .from(representations)
        .where(eq(representations.requestId, own.id))
        .for('update');
      const values = {
        stance: input.stance,
        text: input.text,
        attachments,
        receivedInWriting: false,
        recordedBy: null,
        recordedByName: null,
      };
      const [saved] = await tx
        .insert(representations)
        .values({
          requestId: own.id,
          tenant: own.tenant,
          personId,
          ...values,
          // Both from the clock: a first response reads as made, not edited.
          submittedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: representations.requestId,
          set: { ...values, updatedAt: now },
        })
        .returning();
      if (!saved) throw new Error('The representations were not saved');

      await switchTenant(tx, commission);

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
          receivedInWriting: false,
        },
        eventData: { receivedInWriting: false },
      });
      return {
        row,
        saved,
        released: releasedUploads(previous?.attachments ?? [], input.attachments),
      };
    });

    await releaseUploads(this.documents, this.logger, row.tenant, released);
    if (input.stance === 'consent') await this.workflows.signal(row.id, 'consented');
    return toDeclarantNotice(row, await openFormK(this.cipher, row), saved, this.clock.now());
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

/**
 * Back to the declarant's person context alone after `switchTenant`: `app.tenant` set to `''`
 * matches no tenant policy, as when it was never set (`app.person` is left as it was).
 */
async function leaveTenant(tx: AccessTransaction): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant', '', true)`);
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
