import { HttpStatus, Injectable } from '@nestjs/common';
import { notFoundIfInvisible, type Principal, ProblemException } from '@adili/api-kit';
import { type Database, InjectDatabase, withTenant } from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import { allocateReference, CLR } from '@adili/numbering';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import { findCase, type ReviewTransaction } from '../cases/case-lookup.js';
import { changeCaseStatus } from '../cases/case-status.js';
import {
  type CaseStatus,
  type ClarificationItem,
  type ClarificationStatus,
  clarificationResponses,
  type LetterLanguage,
  clarifications,
  reviewCases,
  reviewTimeline,
} from '../cases/schema.js';
import { Clock, nairobiDate, nairobiYear } from '../clock.js';
import type { ReviewSchema } from '../db/schema.js';
import { DeclarationsClient } from '../declarations/declarations-client.js';
import { DirectoryClient } from '../directory/directory-client.js';
import {
  type DocumentDownload,
  DocumentsClient,
  DocumentsUnavailable,
} from '../documents/documents-client.js';
import { caseTenant } from '../cases/access.js';
import { upstreamUnavailable, withUpstream } from '../internal-api/upstream.js';
import { reviewCopilotDrafts } from '../copilot/draft-schema.js';
import { requireAssignee } from './access.js';
import type {
  ClarificationInput,
  ResolutionInput,
  WithdrawalInput,
} from './clarification-input.js';
import { ClarificationWorkflows } from './clarification-workflows.js';
import { clarificationDueAt } from './contract.js';
import { composeLetter } from './letter.js';
import {
  CLARIFICATION_ISSUED,
  CLARIFICATION_RESOLVED,
  CLARIFICATION_WITHDRAWN,
  type ClarificationEventData,
} from './events.js';
import { clarificationView, type ClarificationView } from './representation.js';

/** The case status while the declarant has a clarification to answer. */
const AWAITING: CaseStatus = 'awaiting-clarification';

/**
 * Clarifications still open on a case: awaiting the declarant (`issued`, `overdue`) or awaiting
 * the reviewer's decision on the response (`responded`). Resolving or withdrawing closes one.
 */
const OPEN: readonly ClarificationStatus[] = ['issued', 'overdue', 'responded'];

/**
 * Clarifications of review cases (spec 07a, Act s.35(2)-(4)): the assignee composes a draft and
 * issues it. Issuing allocates the `CLR` reference, sets the due date from the Commission's
 * policy, moves the case to `awaiting-clarification` and records the timeline entries and events
 * in one transaction, which also starts `ClarificationWorkflow` (letter, notices, then the clock).
 * The assignee then resolves it, raises a follow-up or withdraws it.
 */
@Injectable()
export class ClarificationsService {
  constructor(
    @InjectDatabase() private readonly db: Database<ReviewSchema>,
    private readonly events: EventPublisher,
    private readonly declarations: DeclarationsClient,
    private readonly directory: DirectoryClient,
    private readonly documents: DocumentsClient,
    private readonly workflows: ClarificationWorkflows,
    private readonly clock: Clock,
  ) {}

  async createDraft(
    principal: Principal,
    caseId: string,
    input: ClarificationInput,
  ): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select({ assignee: reviewCases.assignee, personId: reviewCases.personId })
        .from(reviewCases)
        .where(eq(reviewCases.id, caseId));
      const reviewCase = notFoundIfInvisible(found);
      requireAssignee(principal, reviewCase.assignee);
      const drafted = await requireDraftedOnCase(tx, principal, caseId, input);
      const [created] = await tx
        .insert(clarifications)
        .values({
          id: uuidv7(),
          tenant,
          caseId,
          personId: reviewCase.personId,
          status: 'draft',
          ...storedText(input, drafted),
          language: input.language,
          aiAssisted: drafted.size > 0,
          createdBy: principal.subject,
        })
        .returning();
      return clarificationView(notFoundIfInvisible(created));
    });
  }

  async updateDraft(
    principal: Principal,
    clarificationId: string,
    input: ClarificationInput,
  ): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, reviewCase } = await lockForWork(tx, tenant, clarificationId);
      requireAssignee(principal, reviewCase.assignee);
      if (clarification.status !== 'draft') throw notADraft();
      const drafted = await requireDraftedOnCase(
        tx,
        principal,
        reviewCase.id,
        input,
        draftedLanguagesOf(clarification),
      );
      const [updated] = await tx
        .update(clarifications)
        .set({
          ...storedText(input, drafted),
          // A language change keeps each drafted part's own language: the composer says so.
          language: input.language,
          // Once AI-assisted, always: a save that leaves the jobs out keeps the label (ADR-007).
          aiAssisted: clarification.aiAssisted || drafted.size > 0,
        })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      return clarificationView(notFoundIfInvisible(updated));
    });
  }

  async get(principal: Principal, clarificationId: string): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [found] = await tx
        .select()
        .from(clarifications)
        .where(eq(clarifications.id, clarificationId));
      const clarification = notFoundIfInvisible(found);
      return clarificationView(clarification, await responseOf(tx, clarificationId));
    });
  }

  /**
   * A short-lived link to the clarification's letter, for the Commission's review staff who can
   * see the clarification: the documents service hands it out for the Commission (one hop,
   * ADR-013). With the tenant and the declarant, so the route audits the read naming them
   * (ADR-008). 404 while the letter is being produced, as for a clarification not visible.
   */
  async letterDownload(
    principal: Principal,
    clarificationId: string,
  ): Promise<{ download: DocumentDownload; tenant: string; personId: string }> {
    const tenant = caseTenant(principal);
    const found = await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const [row] = await tx
        .select({ letter: clarifications.letterDocumentId, personId: clarifications.personId })
        .from(clarifications)
        .where(eq(clarifications.id, clarificationId));
      return row;
    });
    const { personId, letter: letterId } = notFoundIfInvisible(found);
    // No letter yet (documents is still producing it): nothing to download.
    const letter = notFoundIfInvisible(letterId);
    let download: DocumentDownload | null;
    try {
      download = await this.documents.getIssuedDocumentDownload(letter, tenant, principal.subject);
    } catch (error) {
      if (error instanceof DocumentsUnavailable) {
        throw upstreamUnavailable('documents', 'The documents service could not give the link.');
      }
      throw error;
    }
    return { download: notFoundIfInvisible(download), tenant, personId };
  }

  async issue(principal: Principal, clarificationId: string): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, reviewCase } = await lockForWork(tx, tenant, clarificationId);
      requireAssignee(principal, reviewCase.assignee);
      if (clarification.status !== 'draft') throw notADraft();
      if (clarification.items.length === 0) {
        throw new ProblemException(
          {
            type: 'clarification-has-no-items',
            title: 'Bad Request',
            status: HttpStatus.BAD_REQUEST,
            detail: 'A clarification needs at least one item to be issued.',
          },
          { code: 'clarification-has-no-items' },
        );
      }
      if (now > reviewCase.windowEndsAt) {
        throw new ProblemException(
          {
            type: 'clarification-window-closed',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: `The Commission could request clarification until ${nairobiDate(reviewCase.windowEndsAt)}.`,
          },
          {
            code: 'clarification-window-closed',
            windowEndsAt: reviewCase.windowEndsAt.toISOString(),
          },
        );
      }

      const [policy, commission] = await Promise.all([
        withUpstream(() => this.directory.getClarificationPolicy(tenant)),
        withUpstream(() => this.directory.getCommission(tenant)),
      ]);
      // The declarations read comes before the number: allocating locks the Commission's CLR
      // counter until commit, and every issue at the Commission waits on it.
      const letter = await composeLetter(
        this.declarations,
        { tenant, actingSubject: principal.subject },
        reviewCase,
        commission,
        clarification,
      );
      const reference = await allocateReference(tx, CLR, {
        issuer: commission.issuerCode,
        period: nairobiYear(now),
      });
      const dueAt = clarificationDueAt(now, policy.replyWindowDays);
      const [issued] = await tx
        .update(clarifications)
        .set({ status: 'issued', reference, issuedAt: now, dueAt, letter })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      await tx
        .update(reviewCases)
        .set({ openClarifications: sql`${reviewCases.openClarifications} + 1` })
        .where(eq(reviewCases.id, reviewCase.id));

      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: reviewCase.id,
        kind: 'clarification-issued',
        ref: clarificationId,
        actor: principal.subject,
        summary: `Clarification ${reference} issued, due ${nairobiDate(dueAt)}`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_ISSUED,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: reviewCase.id },
      });
      await changeCaseStatus(tx, this.events, {
        tenant,
        caseId: reviewCase.id,
        from: reviewCase.status,
        to: AWAITING,
        actor: principal.subject,
      });

      // Last, inside the transaction: if Temporal cannot be reached nothing is issued. The
      // workflow's first activity waits for this transaction to commit.
      await this.workflows.start({ tenant, clarificationId });
      return clarificationView(notFoundIfInvisible(issued));
    });
  }

  /**
   * The assignee marks a responded clarification resolved with a note. One still awaiting the
   * declarant (`issued`, `overdue`) is not resolved: the reviewer withdraws one issued in error,
   * and an overdue one escalates (spec 08). When no other clarification of the case is open, the
   * case is `clarified` and then `ready-for-determination`. The workflow's clock ends.
   */
  async resolve(
    principal: Principal,
    clarificationId: string,
    input: ResolutionInput,
  ): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    const now = this.clock.now();
    const view = await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, reviewCase } = await lockForWork(tx, tenant, clarificationId);
      requireAssignee(principal, reviewCase.assignee);
      requireResponded(clarification.status);
      const [resolved] = await tx
        .update(clarifications)
        .set({ status: 'resolved', resolvedAt: now, resolutionNote: input.note })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      const done = notFoundIfInvisible(resolved);
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: reviewCase.id,
        kind: 'clarification-resolved',
        ref: clarificationId,
        actor: principal.subject,
        summary: `Clarification ${done.reference ?? clarificationId} resolved`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_RESOLVED,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: reviewCase.id },
      });
      await this.settleCase(tx, tenant, reviewCase, principal.subject);
      return clarificationView(done, await responseOf(tx, clarificationId));
    });
    await this.workflows.signal(clarificationId, 'resolved');
    return view;
  }

  /**
   * The assignee raises a follow-up: a new draft of the same case with the items, opening and
   * language of the clarification it follows and `followUpOf` naming it, with a timeline entry in the same
   * transaction. Once issued it has its own `CLR` reference, letter and clock.
   */
  async followUp(principal: Principal, clarificationId: string): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    return withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, reviewCase } = await lockForWork(tx, tenant, clarificationId);
      requireAssignee(principal, reviewCase.assignee);
      if (clarification.status === 'draft' || clarification.status === 'withdrawn') {
        throw new ProblemException(
          {
            type: 'not-followable',
            title: 'Conflict',
            status: HttpStatus.CONFLICT,
            detail: `A ${clarification.status} clarification cannot be followed up.`,
          },
          { code: 'not-followable' },
        );
      }
      const [created] = await tx
        .insert(clarifications)
        .values({
          id: uuidv7(),
          tenant,
          caseId: reviewCase.id,
          personId: clarification.personId,
          status: 'draft',
          items: clarification.items.map((item) => ({ ...item, id: uuidv7() })),
          opening: clarification.opening,
          openingAiJobId: clarification.openingAiJobId,
          openingAiLanguage: clarification.openingAiLanguage,
          language: clarification.language,
          aiAssisted: clarification.aiAssisted,
          followUpOf: clarificationId,
          createdBy: principal.subject,
        })
        .returning();
      const draft = notFoundIfInvisible(created);
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: reviewCase.id,
        kind: 'clarification-follow-up',
        ref: draft.id,
        actor: principal.subject,
        summary: `Further clarification on ${clarification.reference ?? clarificationId} drafted`,
      });
      return clarificationView(draft);
    });
  }

  /**
   * The assignee withdraws a clarification issued in error: it becomes `withdrawn` with the
   * reason, its letter is revoked through documents as `issued-in-error` (last before commit, so
   * a documents outage is a 503 and nothing changes), and the workflow's clock ends. When no
   * clarification of the case is left open, the case moves on as after a resolution, or back to
   * `assigned` when none was resolved.
   */
  async withdraw(
    principal: Principal,
    clarificationId: string,
    input: WithdrawalInput,
  ): Promise<ClarificationView> {
    const tenant = caseTenant(principal);
    const view = await withTenant(this.db, { tenant, subject: principal.subject }, async (tx) => {
      const { clarification, reviewCase } = await lockForWork(tx, tenant, clarificationId);
      requireAssignee(principal, reviewCase.assignee);
      requireOpen(clarification.status);
      const [withdrawn] = await tx
        .update(clarifications)
        .set({ status: 'withdrawn', withdrawnReason: input.reason })
        .where(eq(clarifications.id, clarificationId))
        .returning();
      const done = notFoundIfInvisible(withdrawn);
      await tx.insert(reviewTimeline).values({
        id: uuidv7(),
        tenant,
        caseId: reviewCase.id,
        kind: 'clarification-withdrawn',
        ref: clarificationId,
        actor: principal.subject,
        summary: `Clarification ${done.reference ?? clarificationId} withdrawn as issued in error`,
      });
      await this.events.record<ClarificationEventData>(tx, {
        type: CLARIFICATION_WITHDRAWN,
        subject: clarificationId,
        tenant,
        data: { clarificationId, caseId: reviewCase.id },
      });
      await this.settleCase(tx, tenant, reviewCase, principal.subject);
      // A letter documents is still rendering is revoked by the workflow when it is kept.
      const letter = done.letterDocumentId;
      if (letter !== null) {
        await withUpstream(() => this.documents.revoke(letter, tenant, 'issued-in-error'));
      }
      return clarificationView(done, await responseOf(tx, clarificationId));
    });
    await this.workflows.signal(clarificationId, 'withdrawn');
    return view;
  }

  /**
   * After a clarification closed: the case's count of open clarifications and, when none is left
   * while the case awaits clarification, its status: `clarified` then `ready-for-determination`
   * when a clarification of the case was resolved, else back to `assigned`.
   */
  private async settleCase(
    tx: ReviewTransaction,
    tenant: string,
    reviewCase: { id: string; status: CaseStatus },
    actor: string,
  ): Promise<void> {
    const [open] = await tx
      .select({ value: count() })
      .from(clarifications)
      .where(and(eq(clarifications.caseId, reviewCase.id), inArray(clarifications.status, OPEN)));
    const openCount = open?.value ?? 0;
    await tx
      .update(reviewCases)
      .set({ openClarifications: openCount })
      .where(eq(reviewCases.id, reviewCase.id));
    if (openCount > 0 || reviewCase.status !== AWAITING) return;
    const [resolved] = await tx
      .select({ value: count() })
      .from(clarifications)
      .where(and(eq(clarifications.caseId, reviewCase.id), eq(clarifications.status, 'resolved')));
    const path: CaseStatus[] =
      (resolved?.value ?? 0) > 0 ? ['clarified', 'ready-for-determination'] : ['assigned'];
    let from = reviewCase.status;
    for (const to of path) {
      await changeCaseStatus(tx, this.events, { tenant, caseId: reviewCase.id, from, to, actor });
      from = to;
    }
  }
}

/** The clarification and its case, locked for the rest of the transaction; 404 when invisible. */
async function lockForWork(tx: ReviewTransaction, tenant: string, clarificationId: string) {
  const [found] = await tx
    .select()
    .from(clarifications)
    .where(eq(clarifications.id, clarificationId))
    .for('update');
  const clarification = notFoundIfInvisible(found);
  const reviewCase = await findCase(tx, tenant, clarification.caseId, { lock: true });
  return { clarification, reviewCase };
}

async function responseOf(tx: ReviewTransaction, clarificationId: string) {
  const [response] = await tx
    .select()
    .from(clarificationResponses)
    .where(eq(clarificationResponses.clarificationId, clarificationId));
  return response ?? null;
}

function storedItems(
  input: ClarificationInput,
  drafted: ReadonlyMap<string, LetterLanguage | null> = new Map(),
): ClarificationItem[] {
  return input.items.map((item) => ({
    id: uuidv7(),
    sectionKey: item.sectionKey ?? null,
    personKey: item.personKey ?? null,
    itemId: item.itemId ?? null,
    requirement: item.requirement,
    text: item.text,
    aiJobId: item.aiJobId ?? null,
    aiLanguage: item.aiJobId ? (drafted.get(item.aiJobId) ?? null) : null,
  }));
}

/** The items and opening as stored, each drafted part with the language its job drafted in. */
function storedText(
  input: ClarificationInput,
  drafted: ReadonlyMap<string, LetterLanguage | null>,
) {
  return {
    items: storedItems(input, drafted),
    opening: input.opening,
    openingAiJobId: input.openingAiJobId,
    openingAiLanguage: input.openingAiJobId ? (drafted.get(input.openingAiJobId) ?? null) : null,
  };
}

/** The Draft with AI jobs a clarification's text came from, each with the language it drafted in. */
function draftedLanguagesOf(clarification: {
  items: ClarificationItem[];
  openingAiJobId: string | null;
  openingAiLanguage: LetterLanguage | null;
}): Map<string, LetterLanguage | null> {
  const drafted = new Map<string, LetterLanguage | null>();
  for (const item of clarification.items) {
    if (item.aiJobId) drafted.set(item.aiJobId, item.aiLanguage ?? null);
  }
  if (clarification.openingAiJobId) {
    drafted.set(clarification.openingAiJobId, clarification.openingAiLanguage);
  }
  return drafted;
}

/** The Draft with AI jobs a clarification's text came from. */
function aiJobIdsOf(clarification: {
  items: ClarificationItem[];
  openingAiJobId: string | null;
}): Set<string> {
  return new Set(
    [...clarification.items.map((item) => item.aiJobId), clarification.openingAiJobId].filter(
      (id): id is string => id != null,
    ),
  );
}

/**
 * Every Draft with AI job the input names (`aiJobId`, `openingAiJobId`) drafted on this case by
 * the caller: a ready draft of theirs (its text purged after its 24 hours or not: which job
 * drafted it is kept, so the label survives the purge), or one the clarification already names.
 * 400 otherwise, so the AI label (ADR-007) always points at a draft of the case. The jobs named,
 * each with the language it drafted in (null when not known).
 */
async function requireDraftedOnCase(
  tx: ReviewTransaction,
  principal: Principal,
  caseId: string,
  input: ClarificationInput,
  known: ReadonlyMap<string, LetterLanguage | null> = new Map(),
): Promise<Map<string, LetterLanguage | null>> {
  const named = [
    ...aiJobIdsOf({ items: storedItems(input), openingAiJobId: input.openingAiJobId }),
  ];
  if (named.length === 0) return new Map();
  const drafts = await tx
    .select({
      jobId: reviewCopilotDrafts.jobId,
      language: reviewCopilotDrafts.language,
      requestedBy: reviewCopilotDrafts.requestedBy,
      status: reviewCopilotDrafts.status,
    })
    .from(reviewCopilotDrafts)
    .where(and(eq(reviewCopilotDrafts.caseId, caseId), inArray(reviewCopilotDrafts.jobId, named)));
  const drafted = new Map<string, LetterLanguage>();
  for (const draft of drafts) {
    if (draft.jobId === null) continue;
    // One the clarification names already may be another reviewer's, from before a reassignment.
    const usable =
      known.has(draft.jobId) ||
      (draft.requestedBy === principal.subject && draft.status === 'ready');
    if (usable) drafted.set(draft.jobId, draft.language);
  }
  const unknown = named.filter((id) => !known.has(id));
  if (unknown.some((id) => !drafted.has(id))) {
    throw new ProblemException(
      {
        type: 'ai-draft-not-on-case',
        title: 'Bad Request',
        status: HttpStatus.BAD_REQUEST,
        detail: 'An AI-drafted item or opening names no Draft with AI of yours on this case.',
      },
      { code: 'ai-draft-not-on-case' },
    );
  }
  // A job the clarification names already keeps the language saved with it, should its row go.
  return new Map(named.map((id) => [id, drafted.get(id) ?? known.get(id) ?? null]));
}

function notADraft(): ProblemException {
  return new ProblemException(
    {
      type: 'not-a-draft',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: 'The clarification has been issued; it can no longer be changed or issued.',
    },
    { code: 'not-a-draft' },
  );
}

/** Resolving acts on a responded clarification only. */
function requireResponded(status: ClarificationStatus): void {
  if (status === 'responded') return;
  throw new ProblemException(
    {
      type: 'clarification-not-responded',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: `A ${status} clarification cannot be resolved: only a responded one can.`,
    },
    { code: 'clarification-not-responded', clarificationStatus: status },
  );
}

/** Withdrawing acts on an open clarification only. */
function requireOpen(status: ClarificationStatus): void {
  if (OPEN.includes(status)) return;
  throw new ProblemException(
    {
      type: 'clarification-not-open',
      title: 'Conflict',
      status: HttpStatus.CONFLICT,
      detail: `A ${status} clarification cannot be withdrawn.`,
    },
    { code: 'clarification-not-open', clarificationStatus: status },
  );
}
